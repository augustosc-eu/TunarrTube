import path from "node:path";
import { mkdir } from "node:fs/promises";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { getSettings } from "@/lib/settings/service";
import { writeLog } from "@/lib/logging/service";
import { addVideosToCollection, slugify } from "@/lib/sources/service";
import { selectContent } from "@/lib/programming/content-selection";
import { selectContentHeuristically, type HeuristicCandidate, type HeuristicSelectionMode } from "@/lib/programming/heuristic-selection";
import type { AiProviderSetting } from "@/lib/programming/types";
import { renderMediaItem } from "@/lib/renders/service";
import { publishChannelToTunarr } from "@/lib/tunarr/channel-service";

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

// One-shot channel creation from a brief: create the channel, mark it for AI content selection +
// AI programming using the brief text for both (see runChannelBrief below), and queue the single job
// that does the rest. Nothing here is new persistence -- every field it sets already exists from the
// AI Programming feature (programmingOrder/aiScheduleStyle/aiProgrammingInstructions/aiProvider).
export async function createChannelFromBrief(input: { name: string; templateId: string; brief: string; sourceIds: string[]; scheduleStyle?: string | null; aiProvider?: string | null }) {
  const channel = await createChannel({ name: input.name, templateId: input.templateId });
  await db.channel.update({
    where: { id: channel.id },
    data: {
      programmingOrder: "ai",
      aiScheduleStyle: input.scheduleStyle ?? null,
      aiProgrammingInstructions: input.brief,
      aiProvider: input.aiProvider ?? null
    }
  });
  const job = await enqueueChannelJob("channel_brief", { channelId: channel.id }, { sourceIds: input.sourceIds });
  return { channel, jobId: job.id };
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

export async function updateChannel(id: string, input: { name?: string; templateId?: string; programmingOrder?: string; logoAssetPath?: string | null; tunarrRequestedChannelNumber?: number | null; aiProgrammingInstructions?: string | null; aiProvider?: string | null; aiScheduleStyle?: string | null }) {
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
      // Free when present: yt-dlp's own artist/album tags for a video YouTube marked as official
      // music content (lib/youtube/normalize.ts, captured onto Video by enrichVideo). Queuing a
      // metadata_lookup job below only when this doesn't already supply an artist avoids a redundant
      // MusicBrainz/iTunes round-trip for videos that didn't need one.
      artist: sourceVideo.video.artist,
      album: sourceVideo.video.album,
      durationSeconds: sourceVideo.video.durationSeconds,
      sourceThumbnailUrl: sourceVideo.video.thumbnailUrl
    }
  });
  if (!mediaItem.artist && mediaItem.metadataStatus === "pending") await enqueueChannelJob("metadata_lookup", { mediaItemId: mediaItem.id });
  // Every attach path funnels through here (manual add, AI content selection, Smart/heuristic
  // selection), so this single stamp keeps lastSelectedAt current everywhere -- the proxy Smart
  // selection's novelty scoring reads back (lib/programming/heuristic-selection.ts).
  await db.sourceVideo.update({ where: { id: sourceVideoId }, data: { lastSelectedAt: new Date() } });
  await addMediaItemToChannel(channelId, mediaItem.id);
  await writeLog({ category: "channel", channelId, mediaItemId: mediaItem.id, message: `Attached "${mediaItem.title}" to ${channel.name}.` });
  return mediaItem;
}

// Shared by both selection paths below (AI and heuristic/Smart): gathers the candidate pool from
// explicitly chosen Sources' already-downloaded videos, excluding anything already on this channel.
// Returns HeuristicCandidate (a superset of SelectionCandidate -- sourceId/lastSelectedAt are extra
// fields the AI path simply doesn't read) so one query serves both callers.
async function gatherSelectionCandidates(channelId: string, sourceIds: string[]): Promise<{ channel: { id: string; name: string }; candidates: HeuristicCandidate[] }> {
  const channel = await db.channel.findUnique({ where: { id: channelId }, include: { items: { select: { mediaItemId: true } } } });
  if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Channel not found.", 404);

  const sources = await db.source.findMany({ where: { id: { in: sourceIds } }, select: { id: true, name: true } });
  const sourceNameById = new Map(sources.map((source) => [source.id, source.name]));

  const alreadyAttachedMediaItemIds = channel.items.map((item) => item.mediaItemId);
  const alreadyAttachedSourceVideoIds = new Set(
    (await db.mediaItem.findMany({ where: { id: { in: alreadyAttachedMediaItemIds } }, select: { sourceVideoId: true } }))
      .flatMap((item) => (item.sourceVideoId ? [item.sourceVideoId] : []))
  );

  const memberships = await db.sourceVideo.findMany({
    where: { sourceId: { in: sourceIds }, downloadStatus: "complete", membershipStatus: "present" },
    include: { video: true }
  });
  const candidates: HeuristicCandidate[] = memberships.flatMap((membership) => {
    if (alreadyAttachedSourceVideoIds.has(membership.id)) return [];
    const durationMs = (membership.video.durationSeconds ?? 0) * 1000;
    return durationMs > 0
      ? [{
          id: membership.id, title: membership.video.title, durationMs,
          uploadDate: membership.video.uploadDate?.toISOString() ?? null,
          sourceName: sourceNameById.get(membership.sourceId) ?? "Unknown source",
          sourceId: membership.sourceId, artist: membership.video.artist,
          lastSelectedAt: membership.lastSelectedAt?.toISOString() ?? null
        }]
      : [];
  });
  return { channel, candidates };
}

// AI content selection (lib/programming/content-selection.ts:selectContent) -- asks the AI which of the
// gathered candidates fit the given brief, then attaches the ones it picked via the existing
// attachExistingVideo above (so a selection is exactly as idempotent as adding videos by hand:
// attaching the same SourceVideo twice is a no-op, not a duplicate).
export async function runContentSelection(channelId: string, input: { sourceIds: string[]; instructions: string; targetCount?: number; providerOverride?: string | null }, signal?: AbortSignal) {
  const { channel, candidates } = await gatherSelectionCandidates(channelId, input.sourceIds);

  const settings = await getSettings();
  const result = await selectContent({
    candidates, instructions: input.instructions, targetCount: input.targetCount,
    providerOverride: input.providerOverride ?? null, globalProviderSetting: settings.aiProvider as AiProviderSetting, signal
  });

  // result.selectedIds are SourceVideo ids -- exactly what attachExistingVideo expects, since
  // candidate.id above was set to membership.id (the SourceVideo id), not the underlying Video id.
  for (const sourceVideoId of result.selectedIds) {
    await attachExistingVideo(channelId, sourceVideoId);
  }
  await writeLog({ category: "channel", channelId, message: `AI selected ${result.selectedIds.length} of ${candidates.length} candidate clip${candidates.length === 1 ? "" : "s"} for "${channel.name}".` });
  return { candidateCount: candidates.length, selectedCount: result.selectedIds.length };
}

// Non-AI "Smart" content selection (lib/programming/heuristic-selection.ts:selectContentHeuristically)
// -- same candidate pool and attach path as runContentSelection above, but scores/orders candidates with
// a deterministic algorithm (novelty via lastSelectedAt, freshness via uploadDate, optional duration
// fit, plus source/artist grouping) instead of an LLM call. A sibling, not a replacement: both remain
// available side by side from the same UI card (components/ai-content-select-form.tsx).
export async function runHeuristicSelection(channelId: string, input: { sourceIds: string[]; targetCount?: number; mode?: HeuristicSelectionMode; targetDurationSeconds?: number }) {
  const { channel, candidates } = await gatherSelectionCandidates(channelId, input.sourceIds);

  const result = selectContentHeuristically({
    candidates, targetCount: input.targetCount, mode: input.mode ?? "balanced", targetDurationSeconds: input.targetDurationSeconds
  });

  for (const sourceVideoId of result.selectedIds) {
    await attachExistingVideo(channelId, sourceVideoId);
  }
  await writeLog({ category: "channel", channelId, message: `Smart selection picked ${result.selectedIds.length} of ${candidates.length} candidate clip${candidates.length === 1 ? "" : "s"} for "${channel.name}".` });
  return { candidateCount: candidates.length, selectedCount: result.selectedIds.length };
}

// The one job createChannelFromBrief queues: select content -> render every selected clip -> publish
// with AI programming (programmingOrder/aiScheduleStyle/aiProgrammingInstructions/aiProvider were
// already set on the Channel row by createChannelFromBrief, so publishChannelToTunarr picks the
// "ai" branch on its own, same as if a human had set those fields through the regular UI).
// Deliberately one sequential job, not a chain of separate ones (matching how publishChannelToTunarr
// itself already loops materializeRenderForChannel inline rather than fanning out): every step here is
// idempotent (attachExistingVideo dedupes by sourceVideoId, renderMediaItem skips a clip that already
// has a complete RenderedAsset, publishChannelToTunarr updates the same Tunarr channel/Custom Shows in
// place), so a retry after a failure partway through just re-does whatever wasn't finished instead of
// duplicating anything.
export async function runChannelBrief(channelId: string, input: { sourceIds: string[] }, signal?: AbortSignal) {
  const before = await getChannel(channelId);
  if (!before.items.length) {
    await runContentSelection(channelId, { sourceIds: input.sourceIds, instructions: before.aiProgrammingInstructions ?? "" }, signal);
  }
  const channel = await getChannel(channelId);
  for (const item of channel.items) {
    await renderMediaItem(item.mediaItemId, channel.templateId, signal);
  }
  await publishChannelToTunarr(channelId, signal);
  await writeLog({ category: "channel", channelId, message: `Finished building "${channel.name}" from its brief: ${channel.items.length} clip${channel.items.length === 1 ? "" : "s"} selected, rendered, and published.` });
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
