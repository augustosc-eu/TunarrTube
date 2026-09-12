import { mkdir } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { enqueueActiveJob, enqueueActiveJobs } from "@/lib/jobs/enqueue";
import { writeLog } from "@/lib/logging/service";
import { sidecarPathsFor } from "@/lib/naming/service";
import { getSettings } from "@/lib/settings/service";
import { analyzeSource, fetchVideoMetadata } from "@/lib/youtube/ytdlp";
import { validateVideoUrl } from "@/lib/youtube/url";
import type { AnalyzeSourceOptions, PlaylistAnalysis, PlaylistEntry } from "@/lib/youtube/types";

type StoredEntry = Omit<PlaylistEntry, "uploadDate"> & { uploadDate: string | null };

export function slugify(value: string) {
  const slug = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
  return slug || "youtube-playlist";
}

function storeEntries(entries: PlaylistEntry[]): StoredEntry[] {
  return entries.map((entry) => ({ ...entry, uploadDate: entry.uploadDate?.toISOString() ?? null }));
}

function restoreEntries(json: string): PlaylistEntry[] {
  return (JSON.parse(json) as StoredEntry[]).map((entry) => ({ ...entry, uploadDate: entry.uploadDate ? new Date(entry.uploadDate) : null }));
}

async function awaitInBatches(operations: Array<PromiseLike<unknown>>, batchSize = 100) {
  for (let start = 0; start < operations.length; start += batchSize) {
    await Promise.all(operations.slice(start, start + batchSize));
  }
}

export async function analyzeAndStoreDraft(url: string, options: AnalyzeSourceOptions = {}, signal?: AbortSignal) {
  let analysis: PlaylistAnalysis;
  try {
    analysis = await analyzeSource(url, options, signal);
  } catch (error) {
    await writeLog({ level: "error", category: "yt-dlp", message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  await db.importDraft.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const draft = await db.importDraft.create({
    data: {
      url: analysis.url,
      youtubeId: analysis.youtubeId,
      name: analysis.name,
      uploaderName: analysis.uploaderName,
      thumbnailUrl: analysis.thumbnailUrl,
      sourceType: analysis.sourceType,
      feedType: analysis.feedType,
      historyLimit: analysis.historyLimit,
      entriesJson: JSON.stringify(storeEntries(analysis.entries)),
      videoCount: analysis.entries.length,
      expiresAt: new Date(Date.now() + 60 * 60_000)
    }
  });
  await writeLog({ category: "source", message: `Analyzed ${analysis.name}: ${analysis.entries.length} videos found.` });
  return { id: draft.id, name: draft.name, uploaderName: draft.uploaderName, thumbnailUrl: draft.thumbnailUrl, videoCount: draft.videoCount, sourceType: draft.sourceType, feedType: draft.feedType, historyLimit: draft.historyLimit, expiresAt: draft.expiresAt };
}

async function uniqueDirectoryName(name: string) {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  while (await db.source.findUnique({ where: { directoryName: candidate }, select: { id: true } })) {
    candidate = `${base.slice(0, 58)}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export async function createSourceFromDraft(draftId: string, requestedName?: string, playbackMode = "download", syncEnabled = false, syncIntervalMinutes = 360, videoQuality: string | null = null, namingScheme: string | null = null, filenameTemplate: string | null = null) {
  const draft = await db.importDraft.findUnique({ where: { id: draftId } });
  if (!draft || draft.expiresAt < new Date() || draft.consumedAt) throw new AppError("INVALID_IMPORT_DRAFT", "This analysis expired or was already used. Analyze the playlist again.", 410);
  if (draft.sourceType !== "collection") {
    const duplicate = await db.source.findUnique({ where: { sourceType_youtubeId_feedType: { sourceType: draft.sourceType, youtubeId: draft.youtubeId, feedType: draft.feedType } } });
    if (duplicate) throw new AppError("SOURCE_EXISTS", "This YouTube source is already configured.", 409, { sourceId: duplicate.id });
  }
  const name = requestedName?.trim() || draft.name;
  const directoryName = await uniqueDirectoryName(name);
  const settings = await getSettings();
  const mediaDirectory = path.join(/* turbopackIgnore: true */ settings.mediaBaseDirectory, directoryName);
  await mkdir(mediaDirectory, { recursive: true });
  const entries = restoreEntries(draft.entriesJson);
  const source = await db.$transaction(async (tx) => {
    const canSync = draft.sourceType !== "collection" && syncEnabled;
    const created = await tx.source.create({ data: { name, url: draft.url, sourceType: draft.sourceType, youtubeId: draft.sourceType === "collection" ? `collection:${draft.id}` : draft.youtubeId, uploaderName: draft.uploaderName, thumbnailUrl: draft.thumbnailUrl, playbackMode, videoQuality, feedType: draft.feedType, historyLimit: draft.historyLimit, directoryName, mediaDirectory, syncEnabled: canSync, syncIntervalMinutes, nextSyncAt: canSync ? new Date(Date.now() + syncIntervalMinutes * 60_000) : null, namingScheme, filenameTemplate } });
    for (const entry of entries) {
      const video = await tx.video.upsert({
        where: { youtubeId: entry.youtubeId },
        update: { title: entry.title, youtubeUrl: entry.youtubeUrl, thumbnailUrl: entry.thumbnailUrl ?? undefined, availability: entry.availability },
        create: { youtubeId: entry.youtubeId, title: entry.title, youtubeUrl: entry.youtubeUrl, thumbnailUrl: entry.thumbnailUrl, uploader: entry.uploader, durationSeconds: entry.durationSeconds, uploadDate: entry.uploadDate, description: entry.description, availability: entry.availability, artist: entry.artist, album: entry.album }
      });
      await tx.sourceVideo.upsert({
        where: { sourceId_videoId: { sourceId: created.id, videoId: video.id } },
        update: { playlistIndex: entry.playlistIndex },
        create: { sourceId: created.id, videoId: video.id, playlistIndex: entry.playlistIndex }
      });
    }
    await tx.importDraft.update({ where: { id: draft.id }, data: { consumedAt: new Date() } });
    return created;
  });
  const videos = await db.video.findMany({ where: { youtubeId: { in: entries.map((entry) => entry.youtubeId) } }, select: { id: true } });
  await enqueueActiveJobs([
    ...videos.map((video) => ({ type: "metadata", sourceId: source.id, videoId: video.id })),
    { type: "thumbnail", sourceId: source.id },
    ...(playbackMode === "download"
      ? videos.map((video) => ({ type: "download", sourceId: source.id, videoId: video.id, payload: { target: "permanent" } }))
      : [])
  ]);
  if (playbackMode === "download" && videos.length) {
    await db.sourceVideo.updateMany({
      where: { sourceId: source.id, videoId: { in: videos.map((video) => video.id) } },
      data: { downloadStatus: "queued" }
    });
  }
  await writeLog({ category: "source", sourceId: source.id, message: `Added ${source.name} with ${entries.length} videos.` });
  const { kickWorker } = await import("@/lib/jobs/runner");
  kickWorker();
  return source;
}

export async function listSources() {
  return db.source.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { videos: { where: { membershipStatus: "present" } } } } }
  });
}

export async function getSource(id: string) {
  const source = await db.source.findUnique({
    where: { id },
    include: {
      videos: { orderBy: [{ playlistIndex: "asc" }, { createdAt: "asc" }], include: { video: true } }
    }
  });
  if (!source) throw new AppError("SOURCE_NOT_FOUND", "Source not found.", 404);
  return source;
}

export async function syncSource(sourceId: string, signal?: AbortSignal) {
  const source = await db.source.findUnique({ where: { id: sourceId } });
  if (!source) throw new AppError("SOURCE_NOT_FOUND", "Source not found.", 404);
  if (source.sourceType === "collection") throw new AppError("COLLECTION_SYNC_UNSUPPORTED", "Curated video collections are updated by adding individual videos.", 422);
  const analysis = await analyzeSource(source.url, { feedType: source.feedType === "playlist" ? undefined : source.feedType as "videos" | "shorts" | "live" | "all", historyLimit: source.historyLimit }, signal);
  signal?.throwIfAborted();
  // A playlist can contain the same video more than once. SourceVideo is unique by source/video, so
  // keep the last occurrence (matching createSourceFromDraft's upsert behavior) before batching work.
  const entries = [...new Map(analysis.entries.map((entry) => [entry.youtubeId, entry])).values()];
  const seenAt = new Date();
  let newCount = 0;
  const metadataVideoIds: string[] = [];
  await db.$transaction(async (tx) => {
    signal?.throwIfAborted();
    const youtubeIds = entries.map((entry) => entry.youtubeId);
    const existingVideos = await tx.video.findMany({ where: { youtubeId: { in: youtubeIds } } });
    const existingByYoutubeId = new Map(existingVideos.map((video) => [video.youtubeId, video]));
    const missingEntries = entries.filter((entry) => !existingByYoutubeId.has(entry.youtubeId));

    if (missingEntries.length) {
      await tx.video.createMany({ data: missingEntries.map((entry) => ({
        youtubeId: entry.youtubeId, title: entry.title, youtubeUrl: entry.youtubeUrl,
        thumbnailUrl: entry.thumbnailUrl, uploader: entry.uploader, durationSeconds: entry.durationSeconds,
        uploadDate: entry.uploadDate, description: entry.description, availability: entry.availability,
        artist: entry.artist, album: entry.album
      })) });
    }

    const videos = await tx.video.findMany({ where: { youtubeId: { in: youtubeIds } } });
    const byYoutubeId = new Map(videos.map((video) => [video.youtubeId, video]));
    const existingMemberships = await tx.sourceVideo.findMany({
      where: { sourceId, videoId: { in: videos.map((video) => video.id) } },
      select: { id: true, videoId: true, playlistIndex: true }
    });
    const membershipByVideoId = new Map(existingMemberships.map((membership) => [membership.videoId, membership]));

    const videoUpdates = entries.flatMap((entry) => {
      const existing = existingByYoutubeId.get(entry.youtubeId);
      if (!existing) return [];
      const thumbnailChanged = entry.thumbnailUrl != null && entry.thumbnailUrl !== existing.thumbnailUrl;
      if (existing.title === entry.title && existing.youtubeUrl === entry.youtubeUrl && !thumbnailChanged) return [];
      return [tx.video.update({
        where: { id: existing.id },
        data: { title: entry.title, youtubeUrl: entry.youtubeUrl, thumbnailUrl: entry.thumbnailUrl ?? undefined }
      })];
    });
    await awaitInBatches(videoUpdates);

    const newMemberships: Array<{ sourceId: string; videoId: string; playlistIndex: number | null; lastSeenAt: Date }> = [];
    const playlistUpdates = [];
    for (const entry of entries) {
      const video = byYoutubeId.get(entry.youtubeId)!;
      const membership = membershipByVideoId.get(video.id);
      if (!membership) {
        newMemberships.push({ sourceId, videoId: video.id, playlistIndex: entry.playlistIndex, lastSeenAt: seenAt });
        newCount += 1;
      } else if (membership.playlistIndex !== entry.playlistIndex) {
        playlistUpdates.push(tx.sourceVideo.update({ where: { id: membership.id }, data: { playlistIndex: entry.playlistIndex } }));
      }
      if (!existingByYoutubeId.has(entry.youtubeId) || video.metadataStatus !== "complete") metadataVideoIds.push(video.id);
    }
    if (newMemberships.length) await tx.sourceVideo.createMany({ data: newMemberships });
    if (existingMemberships.length) {
      await tx.sourceVideo.updateMany({
        where: { id: { in: existingMemberships.map((membership) => membership.id) } },
        data: { membershipStatus: "present", lastSeenAt: seenAt }
      });
    }
    await awaitInBatches(playlistUpdates);

    if (!(source.sourceType === "channel" && source.historyLimit !== null)) {
      await tx.sourceVideo.updateMany({
        where: { sourceId, videoId: { notIn: videos.map((video) => video.id) } },
        data: { membershipStatus: "missing" }
      });
    }
    await tx.source.update({ where: { id: sourceId }, data: { uploaderName: analysis.uploaderName, thumbnailUrl: analysis.thumbnailUrl, lastSyncedAt: seenAt, lastSyncStatus: "complete", nextSyncAt: source.syncEnabled ? new Date(seenAt.getTime() + source.syncIntervalMinutes * 60_000) : null } });
  });
  const jobs = [
    ...metadataVideoIds.map((videoId) => ({ type: "metadata", sourceId, videoId })),
    { type: "thumbnail", sourceId }
  ];
  if (source.playbackMode === "download") {
    // Excludes "cancelled" and "unavailable" as well as "complete" -- a user-cancelled download must stay
    // cancelled through automatic syncs, and a video downloadVideo() already recorded as permanently gone
    // (lib/downloads/service.ts) would otherwise get a fresh download job queued -- and fail again -- on
    // every single sync forever. Only the explicit retry action (lib/jobs/service.ts) brings either back.
    const fresh = await db.sourceVideo.findMany({ where: { sourceId, membershipStatus: "present", downloadStatus: { notIn: ["complete", "cancelled", "unavailable"] } }, select: { videoId: true } });
    jobs.push(...fresh.map((item) => ({ type: "download", sourceId, videoId: item.videoId, payload: { target: "permanent" } })));
    if (fresh.length) {
      await db.sourceVideo.updateMany({
        where: { sourceId, videoId: { in: fresh.map((item) => item.videoId) } },
        data: { downloadStatus: "queued" }
      });
    }
  }
  if (source.tunarrChannelId && source.tunarrChannelName) jobs.push({ type: "tunarr_refresh", sourceId });
  await enqueueActiveJobs(jobs);
  await writeLog({ category: "sync", sourceId, message: `Synced ${source.name}. Found ${newCount} new video${newCount === 1 ? "" : "s"}.` });
  return { newCount, totalCount: analysis.entries.length, syncedAt: seenAt };
}

export async function enqueueUniqueJob(type: string, sourceId?: string, videoId?: string, payload?: unknown) {
  return enqueueActiveJob({ type, sourceId, videoId, payload });
}

export async function enqueueMetadataRepair() {
  const memberships = await db.sourceVideo.findMany({
    where: { downloadStatus: "complete", localPath: { not: null } },
    select: { sourceId: true, videoId: true }
  });
  for (const membership of memberships) {
    await enqueueUniqueJob("retag", membership.sourceId, membership.videoId);
  }
  await writeLog({ category: "download", message: `Queued metadata repair for ${memberships.length} video${memberships.length === 1 ? "" : "s"}.` });
  const { kickWorker } = await import("@/lib/jobs/runner");
  kickWorker();
  return { queued: memberships.length };
}

export async function enqueueSync(sourceId: string) {
  const source = await db.source.findUnique({ where: { id: sourceId }, select: { id: true, sourceType: true } });
  if (!source) throw new AppError("SOURCE_NOT_FOUND", "Source not found.", 404);
  if (source.sourceType === "collection") throw new AppError("COLLECTION_SYNC_UNSUPPORTED", "Curated video collections do not need synchronization.", 422);
  const job = await enqueueUniqueJob("sync", sourceId);
  await db.source.update({ where: { id: sourceId }, data: { lastSyncStatus: "queued" } });
  const { kickWorker } = await import("@/lib/jobs/runner");
  kickWorker();
  return job;
}

export async function deleteSource(id: string) {
  const source = await db.source.findUnique({ where: { id }, include: { videos: { select: { videoId: true } } } });
  if (!source) throw new AppError("SOURCE_NOT_FOUND", "Source not found.", 404);
  const runningJob = await db.job.findFirst({ where: { sourceId: id, status: "running" }, select: { id: true } });
  if (runningJob) throw new AppError("SOURCE_BUSY", "Wait for the active source job to finish before removing it.", 409);
  const { removeSourceThumbnail } = await import("@/lib/thumbnails/service");
  await removeSourceThumbnail(id);
  await db.$transaction([
    db.job.updateMany({ where: { sourceId: id, status: "queued" }, data: { status: "cancelled", activeKey: null, finishedAt: new Date() } }),
    db.source.delete({ where: { id } })
  ]);
  const orphaned = await db.video.findMany({ where: { id: { in: source.videos.map((item) => item.videoId) }, sources: { none: {} } }, include: { cacheAsset: true } });
  const { rm } = await import("node:fs/promises");
  for (const video of orphaned) {
    if (video.thumbnailPath) await rm(video.thumbnailPath, { force: true });
    if (video.cacheAsset?.localPath) await rm(video.cacheAsset.localPath, { force: true });
  }
  if (orphaned.length) await db.video.deleteMany({ where: { id: { in: orphaned.map((video) => video.id) } } });
  return { deleted: true, preservedMediaDirectory: source.mediaDirectory };
}

// Drops one video from a source -- e.g. after downloadVideo() (lib/downloads/service.ts) records it
// "unavailable" and the user decides it's not coming back, rather than leaving it queued for a retry
// they'll never take. Removes the membership only; the Video row (and any file it owns) is cleaned up
// too, but only once nothing else references it -- the same video can be a member of multiple sources.
export async function removeVideoFromSource(sourceId: string, videoId: string) {
  const membership = await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId, videoId } }, include: { video: true } });
  if (!membership) throw new AppError("VIDEO_NOT_IN_SOURCE", "The video is not part of this source.", 404);
  const activeJob = await db.job.findFirst({ where: { sourceId, videoId, status: { in: ["queued", "running"] } }, select: { id: true } });
  if (activeJob) throw new AppError("VIDEO_BUSY", "Wait for (or cancel/stop) the video's active job before removing it.", 409);
  const { rm } = await import("node:fs/promises");
  if (membership.localPath) {
    // Mirrors unlinkTunarr()'s cleanup (lib/tunarr/service.ts): the sidecar/NFO/poster files this source
    // wrote alongside the video (see lib/downloads/service.ts) share its basename, so pick them up the
    // same way regardless of which naming scheme wrote them.
    await rm(membership.localPath, { force: true });
    for (const sidecar of sidecarPathsFor(membership.localPath)) await rm(sidecar, { force: true });
  }
  await db.sourceVideo.delete({ where: { id: membership.id } });
  // Logged with videoId while the Video row is still guaranteed to exist -- the orphan cleanup below may
  // delete it, and LogEntry.videoId is a foreign key, so writing this any later could fail the same way
  // the removal we're logging just succeeded.
  await writeLog({ category: "source", sourceId, videoId, message: `Removed ${membership.video.youtubeId} from the source.` });
  const stillReferenced = await db.sourceVideo.findFirst({ where: { videoId }, select: { id: true } });
  if (!stillReferenced) {
    const video = await db.video.findUnique({ where: { id: videoId }, include: { cacheAsset: true } });
    if (video?.thumbnailPath) await rm(video.thumbnailPath, { force: true });
    if (video?.cacheAsset?.localPath) await rm(video.cacheAsset.localPath, { force: true });
    await db.video.delete({ where: { id: videoId } }).catch(() => undefined);
  }
  return { removed: true };
}

export async function addVideosToCollection(sourceId: string, inputs: string[], signal?: AbortSignal) {
  const source = await db.source.findUnique({ where: { id: sourceId } });
  if (!source) throw new AppError("SOURCE_NOT_FOUND", "Source not found.", 404);
  if (source.sourceType !== "collection") throw new AppError("COLLECTION_REQUIRED", "Individual videos can only be added to a curated video collection.", 422);

  const urls = [...new Set(inputs.map(validateVideoUrl))];
  const entries = await Promise.all(urls.map((url) => fetchVideoMetadata(url, signal)));
  const addedVideoIds: string[] = [];
  let duplicateCount = 0;
  await db.$transaction(async (tx) => {
    const last = await tx.sourceVideo.findFirst({ where: { sourceId }, orderBy: { playlistIndex: "desc" }, select: { playlistIndex: true } });
    let playlistIndex = last?.playlistIndex ?? 0;
    for (const entry of entries) {
      const video = await tx.video.upsert({
        where: { youtubeId: entry.youtubeId },
        update: { title: entry.title, description: entry.description, uploader: entry.uploader, artist: entry.artist, album: entry.album, durationSeconds: entry.durationSeconds, uploadDate: entry.uploadDate, thumbnailUrl: entry.thumbnailUrl, youtubeUrl: entry.youtubeUrl, availability: entry.availability === "unknown" ? "available" : entry.availability, availabilityReason: null, metadataStatus: "complete" },
        create: { youtubeId: entry.youtubeId, title: entry.title, description: entry.description, uploader: entry.uploader, artist: entry.artist, album: entry.album, durationSeconds: entry.durationSeconds, uploadDate: entry.uploadDate, thumbnailUrl: entry.thumbnailUrl, youtubeUrl: entry.youtubeUrl, availability: entry.availability === "unknown" ? "available" : entry.availability, metadataStatus: "complete" }
      });
      const membership = await tx.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId, videoId: video.id } } });
      if (membership?.membershipStatus === "present") { duplicateCount += 1; continue; }
      playlistIndex += 1;
      await tx.sourceVideo.upsert({
        where: { sourceId_videoId: { sourceId, videoId: video.id } },
        update: { playlistIndex, membershipStatus: "present", lastSeenAt: new Date() },
        create: { sourceId, videoId: video.id, playlistIndex }
      });
      addedVideoIds.push(video.id);
    }
    await tx.source.update({ where: { id: sourceId }, data: { updatedAt: new Date() } });
  });

  if (addedVideoIds.length) await enqueueUniqueJob("thumbnail", sourceId);
  for (const videoId of addedVideoIds) {
    if (source.playbackMode === "download") {
      await enqueueUniqueJob("download", sourceId, videoId, { target: "permanent" });
      await db.sourceVideo.update({ where: { sourceId_videoId: { sourceId, videoId } }, data: { downloadStatus: "queued" } });
    } else if (source.tunarrChannelId) {
      await enqueueUniqueJob("cache", sourceId, videoId);
      await db.sourceVideo.update({ where: { sourceId_videoId: { sourceId, videoId } }, data: { downloadStatus: "queued" } });
    }
  }
  if (source.tunarrChannelId && addedVideoIds.length) await enqueueUniqueJob("tunarr_refresh", sourceId);
  if (addedVideoIds.length) {
    await writeLog({ category: "source", sourceId, message: `Added ${addedVideoIds.length} individual video${addedVideoIds.length === 1 ? "" : "s"} to ${source.name}.` });
    const { kickWorker } = await import("@/lib/jobs/runner");
    kickWorker();
  }
  return { addedCount: addedVideoIds.length, duplicateCount, videoIds: addedVideoIds };
}

export function analysisFromDraft(draft: { url: string; youtubeId: string; name: string; uploaderName: string | null; thumbnailUrl: string | null; sourceType?: string; feedType?: string; historyLimit?: number | null; entriesJson: string }): PlaylistAnalysis {
  const sourceType = draft.sourceType === "channel" ? "channel" : draft.sourceType === "collection" ? "collection" : "playlist";
  return { ...draft, sourceType, feedType: (draft.feedType ?? "playlist") as PlaylistAnalysis["feedType"], historyLimit: draft.historyLimit ?? null, entries: restoreEntries(draft.entriesJson) };
}
