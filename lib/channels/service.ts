import path from "node:path";
import { mkdir } from "node:fs/promises";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { getSettings } from "@/lib/settings/service";
import { writeLog } from "@/lib/logging/service";
import { addVideosToCollection, slugify } from "@/lib/sources/service";

async function uniqueSlug(base: string) {
  let candidate = base;
  let suffix = 2;
  while (await db.channel.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

// Separate from Source's own directoryName uniqueness helper (private to lib/sources/service.ts) --
// a small, self-contained duplicate rather than exporting/touching that file for one shared loop.
async function uniqueSourceDirectoryName(base: string) {
  let candidate = base;
  let suffix = 2;
  while (await db.source.findUnique({ where: { directoryName: candidate }, select: { id: true } })) {
    candidate = `${base.slice(0, 58)}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export async function createChannel(input: { name: string; channelType?: string; templateId: string }) {
  const template = await db.overlayTemplate.findUnique({ where: { id: input.templateId } });
  if (!template) throw new AppError("TEMPLATE_NOT_FOUND", "The selected overlay template does not exist.", 404);

  const settings = await getSettings();
  const slug = await uniqueSlug(slugify(input.name));
  // Namespaced under "_channels" so a channel's storage directory can never collide with a
  // Source's own directoryName (a plain slugify() output, which never starts with "_").
  const storageDirectory = path.join(settings.mediaBaseDirectory, "_channels", slug);
  await mkdir(storageDirectory, { recursive: true });

  const channel = await db.channel.create({
    data: {
      name: input.name,
      channelType: input.channelType ?? template.channelType,
      slug,
      templateId: template.id,
      storageDirectory
    }
  });
  await writeLog({ category: "channel", channelId: channel.id, message: `Created channel "${channel.name}".` });
  return channel;
}

export async function listChannels() {
  return db.channel.findMany({
    orderBy: { updatedAt: "desc" },
    include: { template: true, _count: { select: { items: true } } }
  });
}

export async function getChannel(id: string) {
  const channel = await db.channel.findUnique({
    where: { id },
    include: {
      template: true,
      items: {
        orderBy: { position: "asc" },
        include: { mediaItem: { include: { renders: true, sourceVideo: true } } }
      }
    }
  });
  if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Channel not found.", 404);
  return channel;
}

export async function updateChannel(id: string, input: { name?: string; templateId?: string; programmingOrder?: string; logoAssetPath?: string | null; tunarrRequestedChannelNumber?: number | null }) {
  const channel = await db.channel.findUnique({ where: { id } });
  if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Channel not found.", 404);
  if (input.templateId) {
    const template = await db.overlayTemplate.findUnique({ where: { id: input.templateId } });
    if (!template) throw new AppError("TEMPLATE_NOT_FOUND", "The selected overlay template does not exist.", 404);
  }
  return db.channel.update({ where: { id }, data: input });
}

// Deletes only this app's Channel/ChannelItem/RenderedAsset rows -- never the channel's companion
// intake Source (that Source, and anything it downloaded, is left exactly as-is; the user can
// delete it separately from Sources like any other collection) and never any remote Tunarr channel
// it published, matching this app's existing "delete never destroys media" philosophy.
export async function deleteChannel(id: string) {
  const channel = await db.channel.findUnique({ where: { id } });
  if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Channel not found.", 404);
  await db.channel.delete({ where: { id } });
  await writeLog({ category: "channel", message: `Deleted channel "${channel.name}".` });
}

export async function reorderChannelItems(channelId: string, orderedMediaItemIds: string[]) {
  await db.$transaction(
    orderedMediaItemIds.map((mediaItemId, position) =>
      db.channelItem.update({ where: { channelId_mediaItemId: { channelId, mediaItemId } }, data: { position } })
    )
  );
}

export async function removeChannelItem(channelId: string, mediaItemId: string) {
  await db.channelItem.delete({ where: { channelId_mediaItemId: { channelId, mediaItemId } } });
}

export async function addMediaItemToChannel(channelId: string, mediaItemId: string) {
  const existing = await db.channelItem.findFirst({ where: { channelId }, orderBy: { position: "desc" } });
  const position = (existing?.position ?? -1) + 1;
  return db.channelItem.upsert({
    where: { channelId_mediaItemId: { channelId, mediaItemId } },
    update: {},
    create: { channelId, mediaItemId, position }
  });
}

// Picking an already-downloaded video (via any existing Source, not just this channel's own
// intake source) onto a channel -- no network call, no job, just a pointer. MediaItem.sourceVideoId
// is unique, so this is naturally idempotent: attaching the same SourceVideo twice reuses the same
// MediaItem row (and can then be added to multiple channels via ChannelItem).
export async function attachExistingVideo(channelId: string, sourceVideoId: string) {
  const channel = await db.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Channel not found.", 404);
  const sourceVideo = await db.sourceVideo.findUnique({ where: { id: sourceVideoId }, include: { video: true } });
  if (!sourceVideo) throw new AppError("SOURCE_VIDEO_NOT_FOUND", "That video could not be found.", 404);

  const mediaItem = await db.mediaItem.upsert({
    where: { sourceVideoId },
    update: {},
    create: {
      originType: "sourceVideo",
      sourceVideoId,
      title: sourceVideo.video.title,
      durationSeconds: sourceVideo.video.durationSeconds,
      sourceThumbnailUrl: sourceVideo.video.thumbnailUrl
    }
  });
  await addMediaItemToChannel(channelId, mediaItem.id);
  await writeLog({ category: "channel", channelId, mediaItemId: mediaItem.id, message: `Attached "${mediaItem.title}" to ${channel.name}.` });
  return mediaItem;
}

// Lazily creates (once) the Channel's own companion collection Source -- a real, ordinary Source
// (sourceType: "collection"), visible and manageable through the existing Sources UI like any
// other. This is what lets "paste a YouTube URL onto a channel" reuse the existing, unmodified
// addVideosToCollection()/download-job pipeline instead of a second YouTube-download implementation.
async function ensureChannelIntakeSource(channel: { id: string; name: string; intakeSourceId: string | null }) {
  if (channel.intakeSourceId) {
    const existing = await db.source.findUnique({ where: { id: channel.intakeSourceId } });
    if (existing) return existing;
  }
  const settings = await getSettings();
  const directoryName = await uniqueSourceDirectoryName(`${slugify(channel.name)}-videos`);
  const mediaDirectory = path.join(settings.mediaBaseDirectory, directoryName);
  await mkdir(mediaDirectory, { recursive: true });
  const source = await db.source.create({
    data: {
      name: `${channel.name} — Videos`,
      url: `channel:${channel.id}`,
      sourceType: "collection",
      youtubeId: `collection:channel-intake:${channel.id}`,
      playbackMode: "download",
      directoryName,
      mediaDirectory
    }
  });
  await db.channel.update({ where: { id: channel.id }, data: { intakeSourceId: source.id } });
  await writeLog({ category: "channel", channelId: channel.id, message: `Created "${source.name}" as this channel's video intake collection.` });
  return source;
}

// Preserves channel-generator's original "paste a YouTube URL directly onto a channel" UX, but
// routes entirely through the existing, unmodified collection-Source pipeline (addVideosToCollection,
// lib/sources/service.ts) rather than a separate yt-dlp download implementation -- the video is
// downloaded exactly like any other collection-source video, then wrapped as a MediaItem.
export async function addYoutubeUrlToChannel(channelId: string, url: string, signal?: AbortSignal) {
  const channel = await db.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Channel not found.", 404);
  const intake = await ensureChannelIntakeSource(channel);
  const result = await addVideosToCollection(intake.id, [url], signal);
  const mediaItems = [];
  for (const videoId of result.videoIds) {
    const sourceVideo = await db.sourceVideo.findUniqueOrThrow({ where: { sourceId_videoId: { sourceId: intake.id, videoId } } });
    mediaItems.push(await attachExistingVideo(channelId, sourceVideo.id));
  }
  return { addedCount: result.addedCount, duplicateCount: result.duplicateCount, mediaItems };
}

// A small, independent dedupe-and-create helper for Channel/MediaItem-targeted jobs (render,
// ingest_local_scan, channel_publish) -- deliberately not a change to the existing sourceId/videoId
// enqueueUniqueJob (lib/sources/service.ts:175), so that shared, load-bearing function stays untouched.
export async function enqueueChannelJob(type: string, target: { channelId?: string; mediaItemId?: string }, payload?: unknown) {
  const existing = await db.job.findFirst({
    where: { type, channelId: target.channelId, mediaItemId: target.mediaItemId, status: { in: ["queued", "running"] } }
  });
  if (existing) return existing;
  const job = await db.job.create({
    data: { type, channelId: target.channelId, mediaItemId: target.mediaItemId, payloadJson: payload ? JSON.stringify(payload) : undefined, maxAttempts: 3 }
  });
  const { kickWorker } = await import("@/lib/jobs/runner");
  kickWorker();
  return job;
}
