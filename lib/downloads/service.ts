import { constants } from "node:fs";
import { access, copyFile, link, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { withDownloadPermit } from "@/lib/downloads/limiter";
import { requireFfmpeg } from "@/lib/ffmpeg/service";
import { writeLog } from "@/lib/logging/service";
import { assignEpisodeNumber, resolveVideoPaths, seasonNumberFor, type NamingScheme, type ResolvedVideoPaths } from "@/lib/naming/service";
import { assertWithinDirectory, getSettings } from "@/lib/settings/service";
import { runProcess } from "@/lib/system/process";
import { downloadFormatSelector, resolveEffectiveQuality, type VideoQuality } from "@/lib/youtube/quality";
import { cookiesArgs, getYtDlpPath, isSignInRequiredError, isUnavailableVideoError, unavailabilityReason } from "@/lib/youtube/ytdlp";

// Thrown by downloadVideo()/cacheVideo() below in place of the raw yt-dlp error when the failure means
// retrying automatically will never succeed: the video is gone for good (deleted/private/region-blocked/
// etc.), or it's age-restricted/bot-checked and TunarrTube has no (or no working) cookies configured for
// it (see isSignInRequiredError, lib/youtube/ytdlp.ts) -- by the time this is thrown, the Video/
// SourceVideo rows are already updated to record that. handleJobFailure()
// (lib/jobs/runner.ts) recognizes this type and fails the job immediately instead of retrying it, since
// retrying will never succeed; publishSourceToTunarr()'s prefetch loop (lib/tunarr/service.ts) catches it
// per-video so one dead video doesn't block prefetching the rest of a source's lineup.
export class VideoUnavailableError extends Error {}

type MembershipVideo = { youtubeId: string; title: string; description: string | null; uploader: string | null; uploadDate: Date | null; thumbnailPath: string | null };
type MembershipSource = { name: string; mediaDirectory: string; namingScheme: string | null; filenameTemplate: string | null };

async function exists(file: string) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writeSidecar(target: string, data: unknown) {
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Tunarr's "other_videos" local media scanner ignores embedded container metadata entirely and instead
// reads a Kodi-style NFO sidecar (same basename as the video, ".nfo" extension) for title/plot -- see
// https://tunarr.com/configure/media_sources/local/other_videos/. This is the only mechanism that gets a
// real title/description into Tunarr's guide for the "id"/"template" naming schemes.
function buildMovieNfo(video: { title: string; description: string | null; uploader: string | null; uploadDate: Date | null }) {
  const lines = ["<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>", "<movie>", `  <title>${xmlEscape(video.title)}</title>`];
  if (video.description) lines.push(`  <plot>${xmlEscape(video.description)}</plot>`);
  if (video.uploader) lines.push(`  <studio>${xmlEscape(video.uploader)}</studio>`);
  if (video.uploadDate) lines.push(`  <premiered>${video.uploadDate.toISOString().slice(0, 10)}</premiered>`);
  lines.push("</movie>");
  return `${lines.join("\n")}\n`;
}

// Tunarr's "Shows" local media scanner (https://tunarr.com/configure/media_sources/local/shows/) --
// which the "tvshow" naming scheme targets -- "follows conventions laid out by the Kodi Wiki" for episode
// NFOs, which is also exactly what Emby/Plex/Jellyfin read for a TV episode. One file satisfies every
// consumer. <uniqueid type="youtube"> lets a future mapPrograms-style reconciliation recover the source
// YouTube ID from the NFO even if the filename convention changes again later.
function buildEpisodeNfo(video: { youtubeId: string; title: string; description: string | null; uploadDate: Date | null }, showName: string, season: number, episode: number) {
  const lines = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
    "<episodedetails>",
    `  <title>${xmlEscape(video.title)}</title>`,
    `  <showtitle>${xmlEscape(showName)}</showtitle>`,
    `  <season>${season}</season>`,
    `  <episode>${episode}</episode>`
  ];
  if (video.description) lines.push(`  <plot>${xmlEscape(video.description)}</plot>`);
  if (video.uploadDate) lines.push(`  <aired>${video.uploadDate.toISOString().slice(0, 10)}</aired>`);
  lines.push(`  <uniqueid type="youtube" default="true">${xmlEscape(video.youtubeId)}</uniqueid>`);
  lines.push("</episodedetails>");
  return `${lines.join("\n")}\n`;
}

// The show-level counterpart to buildEpisodeNfo, written once per Source (idempotent overwrite keeps it
// in sync if the Source is renamed) at "<mediaDirectory>/tvshow.nfo" -- both Tunarr's Shows scanner and
// Emby/Plex/Jellyfin expect exactly this filename at the show's root directory.
function buildShowNfo(source: { name: string }) {
  return `${["<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>", "<tvshow>", `  <title>${xmlEscape(source.name)}</title>`, "</tvshow>"].join("\n")}\n`;
}

async function writeNfo(target: string, content: string) {
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, target);
}

// Tunarr's "other_videos"/"Shows" scanners both "scan for associated artwork files" next to each video
// (Kodi's local-artwork convention). posterSuffix is "-poster" for id/template (Tunarr other_videos +
// Kodi movie convention, unchanged from before this feature) or "-thumb" for tvshow (Emby/Kodi reserve
// "-poster" for show/season-level art, "-thumb" for episode-level art). Source: the video's own thumbnail
// already mirrored locally by lib/thumbnails/service.ts -- best-effort, since that mirror job can finish
// after (or fail before) this runs.
async function writePosterArtwork(sourceDirectory: string, directory: string, basename: string, posterSuffix: "-poster" | "-thumb", video: { thumbnailPath: string | null }) {
  if (!video.thumbnailPath || !(await exists(video.thumbnailPath))) return;
  const target = await assertWithinDirectory(sourceDirectory, path.join(directory, `${basename}${posterSuffix}${path.extname(video.thumbnailPath)}`));
  const temp = `${target}.${process.pid}.tmp`;
  await copyFile(video.thumbnailPath, temp);
  await rename(temp, target);
}

function sidecarPayload(scheme: NamingScheme, source: { name: string }, video: MembershipVideo & { youtubeUrl: string; durationSeconds: number | null }, season: number | null, episode: number | null) {
  const base = {
    youtubeId: video.youtubeId,
    title: video.title,
    description: video.description,
    uploader: video.uploader,
    duration: video.durationSeconds,
    uploadDate: video.uploadDate?.toISOString() ?? null,
    source: source.name,
    originalUrl: video.youtubeUrl
  };
  // ".info.json" (tvshow mode) is a superset carrying the season/episode identifiers the request asked
  // for alongside the video -- ".json" (id/template modes) stays exactly the shape it was before this
  // feature, unchanged for existing installs.
  return scheme === "tvshow" ? { ...base, season, episode } : base;
}

// Resolves which naming scheme/template actually applies to a Source: its own override if set, else the
// global AppSettings default -- same "null means inherit" convention as videoQuality/defaultVideoQuality.
async function effectiveNaming(source: MembershipSource) {
  const settings = await getSettings();
  return {
    scheme: (source.namingScheme ?? settings.defaultNamingScheme) as NamingScheme,
    template: source.filenameTemplate ?? settings.defaultFilenameTemplate
  };
}

// Ensures a "tvshow"-scheme membership has a season/episode assigned, lazily and only once (see the
// schema comment on SourceVideo.episodeNumber and lib/naming/service.ts:assignEpisodeNumber). Returns
// null/null for every other scheme, since resolveVideoPaths ignores them in that case.
async function ensureSeasonEpisode(scheme: NamingScheme, membership: { id: string; sourceId: string; seasonNumber: number | null; episodeNumber: number | null; video: { uploadDate: Date | null } }) {
  if (scheme !== "tvshow") return { season: null, episode: null };
  if (membership.seasonNumber !== null && membership.episodeNumber !== null) {
    return { season: membership.seasonNumber, episode: membership.episodeNumber };
  }
  const season = seasonNumberFor(membership.video);
  const episode = await assignEpisodeNumber(membership.sourceId, season, membership.id);
  return { season, episode };
}

async function writeSidecarsAndArt(
  resolved: ResolvedVideoPaths,
  scheme: NamingScheme,
  sourceDirectory: string,
  membership: { source: MembershipSource; video: MembershipVideo & { youtubeUrl: string; durationSeconds: number | null } },
  season: number | null,
  episode: number | null
) {
  const sidecar = await assertWithinDirectory(sourceDirectory, path.join(resolved.directory, `${resolved.basename}${resolved.sidecarExtension}`));
  const nfo = await assertWithinDirectory(sourceDirectory, path.join(resolved.directory, `${resolved.basename}.nfo`));
  await writeSidecar(sidecar, sidecarPayload(scheme, membership.source, membership.video, season, episode));
  const nfoContent = scheme === "tvshow"
    ? buildEpisodeNfo(membership.video, membership.source.name, season ?? seasonNumberFor(membership.video), episode ?? 1)
    : buildMovieNfo(membership.video);
  await writeNfo(nfo, nfoContent);
  if (resolved.showNfoPath) {
    const showNfo = await assertWithinDirectory(sourceDirectory, resolved.showNfoPath);
    await writeNfo(showNfo, buildShowNfo(membership.source));
  }
  await writePosterArtwork(sourceDirectory, resolved.directory, resolved.basename, resolved.posterSuffix, membership.video);
}

async function downloadMp4(youtubeId: string, youtubeUrl: string, target: string, quality: VideoQuality, signal?: AbortSignal) {
  return withDownloadPermit(async () => {
    const targetDirectory = path.dirname(target);
    await mkdir(targetDirectory, { recursive: true });
    const tempRoot = path.join(targetDirectory, "._ytarr-tmp");
    await mkdir(tempRoot, { recursive: true });
    const tempDirectory = path.join(tempRoot, `${youtubeId}-${Date.now()}-${process.pid}`);
    await mkdir(tempDirectory, { recursive: false });
    try {
      const ytdlp = await getYtDlpPath();
      const ffmpeg = await requireFfmpeg();
      await runProcess(ytdlp, [
        "--no-playlist", "--no-overwrites", "--newline", "--no-progress",
        "--ffmpeg-location", path.dirname(ffmpeg),
        "-f", downloadFormatSelector(quality),
        "--concurrent-fragments", "4",
        "--merge-output-format", "mp4", "--remux-video", "mp4", "--embed-metadata",
        "-o", path.join(tempDirectory, `${youtubeId}.%(ext)s`), ...await cookiesArgs(), "--", youtubeUrl
      ], { timeoutMs: 12 * 60 * 60_000, signal });
      const files = await readdir(tempDirectory);
      const output = files.find((file) => file === `${youtubeId}.mp4`);
      if (!output) throw new AppError("DOWNLOAD_OUTPUT_MISSING", "yt-dlp completed without producing the expected MP4.", 502);
      if (!(await exists(target))) await rename(path.join(/* turbopackIgnore: true */ tempDirectory, output), target);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }, signal);
}

async function reuseExistingAsset(sourceId: string, videoId: string, target: string) {
  const asset = await db.sourceVideo.findFirst({
    where: { videoId, sourceId: { not: sourceId }, downloadStatus: "complete", localPath: { not: null } }
  });
  if (!asset?.localPath || !(await exists(asset.localPath))) return false;
  try {
    await link(asset.localPath, target);
  } catch {
    const temp = `${target}.${process.pid}.copying`;
    await copyFile(asset.localPath, temp);
    await rename(temp, target);
  }
  return true;
}

export async function downloadVideo(sourceId: string, videoId: string, signal?: AbortSignal) {
  const membership = await db.sourceVideo.findUnique({
    where: { sourceId_videoId: { sourceId, videoId } },
    include: { source: true, video: true }
  });
  if (!membership) throw new AppError("VIDEO_NOT_IN_SOURCE", "The video is not part of this source.", 404);
  const sourceDir = membership.source.mediaDirectory;
  if (membership.downloadStatus === "complete" && membership.localPath && (await exists(membership.localPath))) {
    if (membership.retentionOrigin !== "permanent") await db.sourceVideo.update({ where: { id: membership.id }, data: { retentionOrigin: "permanent" } });
    return { localPath: membership.localPath, reused: true };
  }

  // Naming/season/episode resolution happens only once we know a real (re)download is about to run --
  // in particular, assignEpisodeNumber persists a number the moment it's called, and that should never
  // happen for a membership the early return above is about to leave untouched (e.g. a naming scheme
  // changed after this video already completed under the old one).
  const { scheme, template } = await effectiveNaming(membership.source);
  const { season, episode } = await ensureSeasonEpisode(scheme, membership);
  const resolved = resolveVideoPaths({ mediaDirectory: sourceDir, scheme, template, source: membership.source, video: membership.video, season, episode });
  await mkdir(resolved.directory, { recursive: true });
  const target = await assertWithinDirectory(sourceDir, path.join(resolved.directory, `${resolved.basename}.mp4`));

  await db.sourceVideo.update({ where: { id: membership.id }, data: { downloadStatus: "downloading" } });
  let reused = await reuseExistingAsset(sourceId, videoId, target);
  try {
    if (!reused) {
      const settings = await getSettings();
      const quality = resolveEffectiveQuality(membership.source.videoQuality, settings.defaultVideoQuality);
      await downloadMp4(membership.video.youtubeId, membership.video.youtubeUrl, target, quality, signal);
    }
    const details = await stat(target);
    await writeSidecarsAndArt(resolved, scheme, sourceDir, membership, season, episode);
    await db.sourceVideo.update({ where: { id: membership.id }, data: { downloadStatus: "complete", localPath: target, fileSize: details.size, retentionOrigin: "permanent" } });
    await writeLog({ category: "download", sourceId, videoId, message: `${reused ? "Linked" : "Downloaded"} ${membership.video.youtubeId}.` });
    return { localPath: target, fileSize: details.size, reused };
  } catch (error) {
    // A user-requested stop (see stopJob() in lib/jobs/service.ts) aborts `signal`, which is what makes
    // runProcess() reject here -- record it as "cancelled" rather than "failed" so it reads like the
    // queued-cancellation case instead of a real error, and so automatic re-enqueue paths leave it alone.
    const message = error instanceof Error ? error.message : String(error);
    const unavailable = !signal?.aborted && (isUnavailableVideoError(message) || isSignInRequiredError(message));
    if (unavailable) {
      // Gone for good (or -- see isSignInRequiredError -- gated behind a sign-in TunarrTube isn't
      // authenticated for), not a transient failure -- record it on the Video so every source sharing it
      // (and the UI) can see why, and mark this membership distinctly from an ordinary "failed" so
      // syncSource (lib/sources/service.ts) stops re-queuing a fresh download attempt on every future
      // sync. The user can still retry it from the Jobs page (e.g. after configuring cookies), or remove
      // it from the source.
      const reason = await unavailabilityReason(membership.video.youtubeUrl, message);
      await db.video.update({ where: { id: membership.video.id }, data: { availability: "unavailable", availabilityReason: reason } });
      await writeLog({ level: "warn", category: "download", sourceId, videoId, message: `${membership.video.youtubeId} is unavailable, won't retry automatically: ${reason}` });
    }
    await db.sourceVideo.update({ where: { id: membership.id }, data: { downloadStatus: unavailable ? "unavailable" : signal?.aborted ? "cancelled" : "failed" } });
    throw unavailable ? new VideoUnavailableError(message) : error;
  }
}

export async function retagVideo(sourceId: string, videoId: string) {
  const membership = await db.sourceVideo.findUnique({
    where: { sourceId_videoId: { sourceId, videoId } },
    include: { source: true, video: true }
  });
  if (!membership) throw new AppError("VIDEO_NOT_IN_SOURCE", "The video is not part of this source.", 404);
  if (membership.downloadStatus !== "complete" || !membership.localPath || !(await exists(membership.localPath))) {
    return { skipped: true };
  }
  // Tunarr's scanners never read the video file's own container metadata -- they read the NFO sidecar
  // (see buildMovieNfo/buildEpisodeNfo above). So repairing metadata is a pair of cheap local file
  // writes, not a video re-encode: no ffmpeg, and the media file itself is never touched. The existing
  // file's basename/directory (from localPath) is reused as-is -- retagging never renames a file, only
  // its sidecars, consistent with the "naming scheme changes only affect future downloads" rule.
  const { scheme } = await effectiveNaming(membership.source);
  const directory = path.dirname(membership.localPath);
  const basename = path.basename(membership.localPath, path.extname(membership.localPath));
  const posterSuffix = scheme === "tvshow" ? "-thumb" : "-poster";
  const sidecarExtension = scheme === "tvshow" ? ".info.json" : ".json";
  const resolved: ResolvedVideoPaths = {
    directory,
    basename,
    posterSuffix,
    sidecarExtension,
    showNfoPath: scheme === "tvshow" ? path.join(membership.source.mediaDirectory, "tvshow.nfo") : null
  };
  const { season, episode } = scheme === "tvshow"
    ? { season: membership.seasonNumber ?? seasonNumberFor(membership.video), episode: membership.episodeNumber ?? 1 }
    : { season: null, episode: null };
  await writeSidecarsAndArt(resolved, scheme, membership.source.mediaDirectory, membership, season, episode);
  await writeLog({ category: "download", sourceId, videoId, message: `Refreshed metadata sidecar for ${membership.video.youtubeId}.` });
  return { localPath: membership.localPath };
}

// A Video/CacheAsset is 1:1, but a Video can be shared across multiple Sources with different quality
// overrides; the cache isn't keyed by quality, so whichever source's job fills it first determines the
// cached resolution until eviction -- same class of behavior as reuseExistingAsset's hardlink sharing.
// Deliberately always "<youtubeId>.mp4" regardless of naming scheme -- this is an internal cache
// directory (._ytarr-cache), never the user-organized library the naming scheme is about.
export async function cacheVideo(videoId: string, sourceId?: string, signal?: AbortSignal) {
  const video = await db.video.findUnique({ where: { id: videoId }, include: { cacheAsset: true } });
  if (!video) throw new AppError("VIDEO_NOT_FOUND", "Video not found.", 404);
  if (video.cacheAsset?.status === "complete" && video.cacheAsset.localPath && await exists(video.cacheAsset.localPath)) {
    await touchCacheAsset(video.cacheAsset.id);
    return video.cacheAsset;
  }
  const settings = await getSettings();
  const source = sourceId ? await db.source.findUnique({ where: { id: sourceId }, select: { videoQuality: true } }) : null;
  const quality = resolveEffectiveQuality(source?.videoQuality, settings.defaultVideoQuality);
  const directory = path.join(settings.mediaBaseDirectory, "._ytarr-cache", "videos");
  await mkdir(directory, { recursive: true });
  const target = await assertWithinDirectory(settings.mediaBaseDirectory, path.join(directory, `${video.youtubeId}.mp4`));
  const asset = await db.cacheAsset.upsert({
    where: { videoId },
    create: { videoId, status: "downloading", localPath: target },
    update: { status: "downloading", localPath: target, error: null }
  });
  try {
    await downloadMp4(video.youtubeId, video.youtubeUrl, target, quality, signal);
    const details = await stat(target);
    const complete = await db.cacheAsset.update({ where: { id: asset.id }, data: { status: "complete", fileSize: details.size, cachedAt: new Date(), lastAccessedAt: new Date(), error: null } });
    await writeLog({ category: "cache", videoId, message: `Cached ${video.youtubeId}.` });
    const { enforceCachePolicy } = await import("@/lib/cache/service");
    await enforceCachePolicy();
    return complete;
  } catch (error) {
    // See the matching comment in downloadVideo() above: a stop request aborts `signal`, and that should
    // read as "cancelled" rather than a real failure.
    const message = error instanceof Error ? error.message : String(error);
    const unavailable = !signal?.aborted && (isUnavailableVideoError(message) || isSignInRequiredError(message));
    if (unavailable) {
      const reason = await unavailabilityReason(video.youtubeUrl, message);
      await db.video.update({ where: { id: videoId }, data: { availability: "unavailable", availabilityReason: reason } });
      await writeLog({ level: "warn", category: "cache", videoId, message: `${video.youtubeId} is unavailable, won't retry automatically: ${reason}` });
    }
    await db.cacheAsset.update({
      where: { id: asset.id },
      data: signal?.aborted ? { status: "cancelled", error: null } : { status: "failed", error: message.slice(-2000) }
    });
    throw unavailable ? new VideoUnavailableError(message) : error;
  }
}

export async function touchCacheAsset(id: string) {
  const asset = await db.cacheAsset.findUnique({ where: { id }, select: { lastAccessedAt: true } });
  if (!asset || (asset.lastAccessedAt && Date.now() - asset.lastAccessedAt.getTime() < 5 * 60_000)) return;
  await db.cacheAsset.update({ where: { id }, data: { lastAccessedAt: new Date() } });
}

export async function materializeForTunarr(sourceId: string, videoId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const membership = await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId, videoId } }, include: { source: true, video: { include: { cacheAsset: true } } } });
  if (!membership) throw new AppError("VIDEO_NOT_IN_SOURCE", "The video is not part of this source.", 404);
  if (membership.retentionOrigin === "permanent" && membership.localPath && await exists(membership.localPath)) return membership.localPath;
  // A user-cancelled cache job must stay cancelled through automatic Tunarr publish/refresh prefetching --
  // leave this video out of the lineup (same as one that was never cached) until an explicit retry.
  if (membership.video.cacheAsset?.status === "cancelled") return null;
  // Likewise for a video already recorded as permanently unavailable (see cacheVideo()'s catch above) --
  // without this, every automatic Tunarr refresh would call cacheVideo() again and immediately re-fail.
  if (membership.video.availability === "unavailable") return null;
  const asset = await cacheVideo(videoId, sourceId, signal);
  signal?.throwIfAborted();
  if (!asset.localPath) throw new AppError("CACHE_OUTPUT_MISSING", "The cached file is unavailable.", 500);
  const sourceDir = membership.source.mediaDirectory;
  const { scheme, template } = await effectiveNaming(membership.source);
  const { season, episode } = await ensureSeasonEpisode(scheme, membership);
  const resolved = resolveVideoPaths({ mediaDirectory: sourceDir, scheme, template, source: membership.source, video: membership.video, season, episode });
  await mkdir(resolved.directory, { recursive: true });
  const target = await assertWithinDirectory(sourceDir, path.join(resolved.directory, `${resolved.basename}.mp4`));
  if (!(await exists(target))) {
    try { await link(asset.localPath, target); }
    catch { const temp = `${target}.${process.pid}.copying`; await copyFile(asset.localPath, temp); await rename(temp, target); }
  }
  const details = await stat(target);
  await writeSidecarsAndArt(resolved, scheme, sourceDir, membership, season, episode);
  await db.sourceVideo.update({ where: { id: membership.id }, data: { downloadStatus: "complete", localPath: target, fileSize: details.size, retentionOrigin: "tunarr" } });
  return target;
}
