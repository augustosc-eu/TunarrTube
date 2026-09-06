import { constants } from "node:fs";
import { access, copyFile, link, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { requireFfmpeg } from "@/lib/ffmpeg/service";
import { writeLog } from "@/lib/logging/service";
import { assertWithinDirectory, getSettings } from "@/lib/settings/service";
import { runProcess } from "@/lib/system/process";
import { downloadFormatSelector, resolveEffectiveQuality, type VideoQuality } from "@/lib/youtube/quality";
import { getYtDlpPath } from "@/lib/youtube/ytdlp";

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
// real title/description into Tunarr's guide for this library type.
function buildNfo(video: { title: string; description: string | null; uploader: string | null; uploadDate: Date | null }) {
  const lines = ["<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>", "<movie>", `  <title>${xmlEscape(video.title)}</title>`];
  if (video.description) lines.push(`  <plot>${xmlEscape(video.description)}</plot>`);
  if (video.uploader) lines.push(`  <studio>${xmlEscape(video.uploader)}</studio>`);
  if (video.uploadDate) lines.push(`  <premiered>${video.uploadDate.toISOString().slice(0, 10)}</premiered>`);
  lines.push("</movie>");
  return `${lines.join("\n")}\n`;
}

async function writeNfo(target: string, video: { title: string; description: string | null; uploader: string | null; uploadDate: Date | null }) {
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, buildNfo(video), "utf8");
  await rename(temp, target);
}

// Tunarr's "other_videos" scanner also "scans for associated artwork files" next to each video (same
// docs page as the NFO convention above), following Kodi's local-artwork naming: "<video basename>-poster.<ext>"
// in the same directory. Without this file Tunarr has no image for the program and its guide/now-playing
// UI shows a broken thumbnail. Source: the video's own thumbnail already mirrored locally by
// lib/thumbnails/service.ts -- best-effort, since that mirror job can finish after (or fail before) this runs.
async function writePosterArtwork(mediaDirectory: string, video: { youtubeId: string; thumbnailPath: string | null }) {
  if (!video.thumbnailPath || !(await exists(video.thumbnailPath))) return;
  const target = await assertWithinDirectory(mediaDirectory, path.join(mediaDirectory, `${video.youtubeId}-poster${path.extname(video.thumbnailPath)}`));
  const temp = `${target}.${process.pid}.tmp`;
  await copyFile(video.thumbnailPath, temp);
  await rename(temp, target);
}

async function downloadMp4(youtubeId: string, youtubeUrl: string, target: string, quality: VideoQuality, signal?: AbortSignal) {
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
      "-o", path.join(tempDirectory, `${youtubeId}.%(ext)s`), "--", youtubeUrl
    ], { timeoutMs: 12 * 60 * 60_000, signal });
    const files = await readdir(tempDirectory);
    const output = files.find((file) => file === `${youtubeId}.mp4`);
    if (!output) throw new AppError("DOWNLOAD_OUTPUT_MISSING", "yt-dlp completed without producing the expected MP4.", 502);
    if (!(await exists(target))) await rename(path.join(/* turbopackIgnore: true */ tempDirectory, output), target);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
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
  await mkdir(sourceDir, { recursive: true });
  const target = await assertWithinDirectory(sourceDir, path.join(sourceDir, `${membership.video.youtubeId}.mp4`));
  const sidecar = await assertWithinDirectory(sourceDir, path.join(sourceDir, `${membership.video.youtubeId}.json`));
  const nfo = await assertWithinDirectory(sourceDir, path.join(sourceDir, `${membership.video.youtubeId}.nfo`));
  if (membership.downloadStatus === "complete" && membership.localPath && (await exists(membership.localPath))) {
    if (membership.retentionOrigin !== "permanent") await db.sourceVideo.update({ where: { id: membership.id }, data: { retentionOrigin: "permanent" } });
    return { localPath: membership.localPath, reused: true };
  }

  await db.sourceVideo.update({ where: { id: membership.id }, data: { downloadStatus: "downloading" } });
  let reused = await reuseExistingAsset(sourceId, videoId, target);
  try {
    if (!reused) {
      const settings = await getSettings();
      const quality = resolveEffectiveQuality(membership.source.videoQuality, settings.defaultVideoQuality);
      await downloadMp4(membership.video.youtubeId, membership.video.youtubeUrl, target, quality, signal);
    }
    const details = await stat(target);
    await writeSidecar(sidecar, {
      youtubeId: membership.video.youtubeId,
      title: membership.video.title,
      description: membership.video.description,
      duration: membership.video.durationSeconds,
      uploadDate: membership.video.uploadDate?.toISOString() ?? null,
      source: membership.source.name,
      originalUrl: membership.video.youtubeUrl
    });
    await writeNfo(nfo, membership.video);
    await writePosterArtwork(sourceDir, membership.video);
    await db.sourceVideo.update({ where: { id: membership.id }, data: { downloadStatus: "complete", localPath: target, fileSize: details.size, retentionOrigin: "permanent" } });
    await writeLog({ category: "download", sourceId, videoId, message: `${reused ? "Linked" : "Downloaded"} ${membership.video.youtubeId}.` });
    return { localPath: target, fileSize: details.size, reused };
  } catch (error) {
    // A user-requested stop (see stopJob() in lib/jobs/service.ts) aborts `signal`, which is what makes
    // runProcess() reject here -- record it as "cancelled" rather than "failed" so it reads like the
    // queued-cancellation case instead of a real error, and so automatic re-enqueue paths leave it alone.
    await db.sourceVideo.update({ where: { id: membership.id }, data: { downloadStatus: signal?.aborted ? "cancelled" : "failed" } });
    throw error;
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
  // Tunarr's "other_videos" scanner never reads the video file's own container metadata -- it reads a
  // Kodi-style ".nfo" sidecar (see buildNfo above). So repairing metadata is a pair of cheap local file
  // writes, not a video re-encode: no ffmpeg, and the media file itself is never touched.
  const sidecar = await assertWithinDirectory(membership.source.mediaDirectory, path.join(membership.source.mediaDirectory, `${membership.video.youtubeId}.json`));
  const nfo = await assertWithinDirectory(membership.source.mediaDirectory, path.join(membership.source.mediaDirectory, `${membership.video.youtubeId}.nfo`));
  await writeSidecar(sidecar, {
    youtubeId: membership.video.youtubeId,
    title: membership.video.title,
    description: membership.video.description,
    duration: membership.video.durationSeconds,
    uploadDate: membership.video.uploadDate?.toISOString() ?? null,
    source: membership.source.name,
    originalUrl: membership.video.youtubeUrl
  });
  await writeNfo(nfo, membership.video);
  await writePosterArtwork(membership.source.mediaDirectory, membership.video);
  await writeLog({ category: "download", sourceId, videoId, message: `Refreshed metadata sidecar for ${membership.video.youtubeId}.` });
  return { localPath: membership.localPath };
}

// A Video/CacheAsset is 1:1, but a Video can be shared across multiple Sources with different quality
// overrides; the cache isn't keyed by quality, so whichever source's job fills it first determines the
// cached resolution until eviction -- same class of behavior as reuseExistingAsset's hardlink sharing.
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
    await db.cacheAsset.update({
      where: { id: asset.id },
      data: signal?.aborted ? { status: "cancelled", error: null } : { status: "failed", error: (error instanceof Error ? error.message : String(error)).slice(-2000) }
    });
    throw error;
  }
}

export async function touchCacheAsset(id: string) {
  const asset = await db.cacheAsset.findUnique({ where: { id }, select: { lastAccessedAt: true } });
  if (!asset || (asset.lastAccessedAt && Date.now() - asset.lastAccessedAt.getTime() < 5 * 60_000)) return;
  await db.cacheAsset.update({ where: { id }, data: { lastAccessedAt: new Date() } });
}

export async function materializeForTunarr(sourceId: string, videoId: string) {
  const membership = await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId, videoId } }, include: { source: true, video: { include: { cacheAsset: true } } } });
  if (!membership) throw new AppError("VIDEO_NOT_IN_SOURCE", "The video is not part of this source.", 404);
  if (membership.retentionOrigin === "permanent" && membership.localPath && await exists(membership.localPath)) return membership.localPath;
  // A user-cancelled cache job must stay cancelled through automatic Tunarr publish/refresh prefetching --
  // leave this video out of the lineup (same as one that was never cached) until an explicit retry.
  if (membership.video.cacheAsset?.status === "cancelled") return null;
  const asset = await cacheVideo(videoId, sourceId);
  if (!asset.localPath) throw new AppError("CACHE_OUTPUT_MISSING", "The cached file is unavailable.", 500);
  await mkdir(membership.source.mediaDirectory, { recursive: true });
  const target = await assertWithinDirectory(membership.source.mediaDirectory, path.join(membership.source.mediaDirectory, `${membership.video.youtubeId}.mp4`));
  if (!(await exists(target))) {
    try { await link(asset.localPath, target); }
    catch { const temp = `${target}.${process.pid}.copying`; await copyFile(asset.localPath, temp); await rename(temp, target); }
  }
  const details = await stat(target);
  await writeSidecar(path.join(membership.source.mediaDirectory, `${membership.video.youtubeId}.json`), {
    youtubeId: membership.video.youtubeId, title: membership.video.title, description: membership.video.description,
    duration: membership.video.durationSeconds, uploadDate: membership.video.uploadDate?.toISOString() ?? null,
    source: membership.source.name, originalUrl: membership.video.youtubeUrl
  });
  await writeNfo(path.join(membership.source.mediaDirectory, `${membership.video.youtubeId}.nfo`), membership.video);
  await writePosterArtwork(membership.source.mediaDirectory, membership.video);
  await db.sourceVideo.update({ where: { id: membership.id }, data: { downloadStatus: "complete", localPath: target, fileSize: details.size, retentionOrigin: "tunarr" } });
  return target;
}
