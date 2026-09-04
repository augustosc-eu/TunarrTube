import path from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { writeLog } from "@/lib/logging/service";
import { getSettings, normalizeTunarrUrl, translatePathForTunarr } from "@/lib/settings/service";
import { enqueueUniqueJob } from "@/lib/sources/service";
import { materializeForTunarr } from "@/lib/downloads/service";
import { rm } from "node:fs/promises";
import { TunarrApiClient, type TunarrChannel, type TunarrProgram } from "@/lib/tunarr/client";

export type ProgrammingOrder = "playlist" | "oldest" | "newest" | "random";
export type PublishTunarrInput = { channelName: string; channelNumber?: number; programmingOrder: ProgrammingOrder; prefetch?: boolean };

export async function testTunarrConnection(inputUrl?: string, signal?: AbortSignal) {
  const tunarrUrl = inputUrl ? normalizeTunarrUrl(inputUrl) : (await getSettings()).tunarrUrl;
  const result = await new TunarrApiClient(tunarrUrl).testConnection(signal);
  await writeLog({ category: "tunarr", message: `Connected to Tunarr ${result.version.tunarr} at ${tunarrUrl}.` });
  return { url: tunarrUrl, ...result };
}

function samePath(left: string, right: string) {
  return path.resolve(left) === path.resolve(right);
}

async function ensureLocalMediaSource(client: TunarrApiClient, source: { id: string; name: string; mediaDirectory: string; tunarrMediaSourceId: string | null }, signal?: AbortSignal) {
  const tunarrDirectory = await translatePathForTunarr(source.mediaDirectory);
  let mediaSources = await client.listMediaSources(signal);
  let mediaSource = mediaSources.find((candidate) => candidate.type === "local" && candidate.paths?.some((candidatePath) => samePath(candidatePath, tunarrDirectory)));
  if (!mediaSource) {
    const id = await client.createLocalMediaSource(`TunarrTube - ${source.name}`, tunarrDirectory, signal);
    mediaSources = await client.listMediaSources(signal);
    mediaSource = mediaSources.find((candidate) => candidate.id === id);
  }
  if (!mediaSource) throw new AppError("TUNARR_MEDIA_SOURCE_MISSING", "Tunarr did not return the newly created local media source.", 502);
  const library = mediaSource.libraries.find((candidate) => candidate.enabled && (samePath(candidate.externalKey, tunarrDirectory) || candidate.mediaType === "other_videos")) ?? mediaSource.libraries[0];
  if (!library) throw new AppError("TUNARR_LIBRARY_MISSING", "The Tunarr local media source has no library to scan.", 502);
  await db.source.update({ where: { id: source.id }, data: { tunarrMediaSourceId: mediaSource.id, tunarrLibraryId: library.id } });
  return { mediaSourceId: mediaSource.id, libraryId: library.id };
}

export function orderMemberships<T extends { playlistIndex: number | null; video: { uploadDate: Date | null } }>(memberships: T[], order: ProgrammingOrder) {
  const sorted = [...memberships];
  if (order === "playlist") sorted.sort((a, b) => (a.playlistIndex ?? Number.MAX_SAFE_INTEGER) - (b.playlistIndex ?? Number.MAX_SAFE_INTEGER));
  if (order === "oldest") sorted.sort((a, b) => (a.video.uploadDate?.getTime() ?? 0) - (b.video.uploadDate?.getTime() ?? 0));
  if (order === "newest") sorted.sort((a, b) => (b.video.uploadDate?.getTime() ?? 0) - (a.video.uploadDate?.getTime() ?? 0));
  if (order === "random") {
    for (let index = sorted.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [sorted[index], sorted[swap]] = [sorted[swap], sorted[index]];
    }
  }
  return sorted;
}

export function mapPrograms(programs: TunarrProgram[], memberships: Array<{ video: { youtubeId: string } }>) {
  const byYoutubeId = new Map<string, TunarrProgram>();
  for (const program of programs) {
    const externalId = program.program?.externalId;
    if (typeof externalId !== "string") continue;
    byYoutubeId.set(path.basename(externalId, path.extname(externalId)), program);
  }
  return memberships.flatMap((membership) => {
    const program = byYoutubeId.get(membership.video.youtubeId);
    return program && program.duration > 0 ? [{ type: "content" as const, id: program.id, duration: program.duration }] : [];
  });
}

function channelPayload(input: PublishTunarrInput, id: string, number: number, duration: number, transcodeConfigId: string, thumbnailUrl: string | null, existing?: TunarrChannel) {
  return {
    id,
    name: input.channelName,
    number,
    duration,
    startTime: typeof existing?.startTime === "number" ? existing.startTime : Math.floor(Date.now() / 60_000) * 60_000,
    disableFillerOverlay: typeof existing?.disableFillerOverlay === "boolean" ? existing.disableFillerOverlay : false,
    groupTitle: typeof existing?.groupTitle === "string" ? existing.groupTitle : "TunarrTube",
    guideMinimumDuration: typeof existing?.guideMinimumDuration === "number" ? existing.guideMinimumDuration : 30_000,
    stealth: typeof existing?.stealth === "boolean" ? existing.stealth : false,
    streamMode: typeof existing?.streamMode === "string" ? existing.streamMode : "hls",
    transcodeConfigId: typeof existing?.transcodeConfigId === "string" ? existing.transcodeConfigId : transcodeConfigId,
    subtitlesEnabled: typeof existing?.subtitlesEnabled === "boolean" ? existing.subtitlesEnabled : false,
    icon: existing?.icon ?? { path: thumbnailUrl ?? "", width: 0, duration: 0, position: "bottom-right" },
    offline: existing?.offline ?? { mode: "pic" },
    ...(Array.isArray(existing?.fillerCollections) ? { fillerCollections: existing.fillerCollections } : {}),
    ...(typeof existing?.fillerRepeatCooldown === "number" ? { fillerRepeatCooldown: existing.fillerRepeatCooldown } : {}),
    ...(typeof existing?.guideFlexTitle === "string" ? { guideFlexTitle: existing.guideFlexTitle } : {}),
    ...(existing?.watermark ? { watermark: existing.watermark } : {}),
    ...(existing?.onDemand ? { onDemand: existing.onDemand } : {}),
    ...(Array.isArray(existing?.subtitlePreferences) ? { subtitlePreferences: existing.subtitlePreferences } : {})
  };
}

export async function publishSourceToTunarr(sourceId: string, input: PublishTunarrInput, signal?: AbortSignal) {
  let source = await db.source.findUnique({
    where: { id: sourceId },
    include: { videos: { where: { membershipStatus: "present" }, include: { video: true } } }
  });
  if (!source) throw new AppError("SOURCE_NOT_FOUND", "Source not found.", 404);
  if (source.playbackMode !== "download" && input.prefetch !== false) {
    for (const membership of source.videos) await materializeForTunarr(sourceId, membership.videoId);
    source = await db.source.findUniqueOrThrow({ where: { id: sourceId }, include: { videos: { where: { membershipStatus: "present" }, include: { video: true } } } });
  }
  source.videos = source.videos.filter((membership) => membership.downloadStatus === "complete" && membership.localPath);
  if (!source.videos.length) throw new AppError("TUNARR_NO_MEDIA", "Download at least one video before creating a Tunarr channel.", 422);
  const settings = await getSettings();
  const client = new TunarrApiClient(settings.tunarrUrl);
  const discovery = await client.discover(signal);
  const missing = Object.entries(discovery.capabilities).filter(([, supported]) => !supported).map(([name]) => name);
  if (missing.length) throw new AppError("TUNARR_UNSUPPORTED_API", `Tunarr ${discovery.openApiVersion ?? "server"} is missing required API capabilities: ${missing.join(", ")}.`, 422);

  const local = await ensureLocalMediaSource(client, source, signal);
  await client.scanLibrary(local.mediaSourceId, local.libraryId, signal);
  await client.waitForLibraryScan(local.mediaSourceId, local.libraryId, signal);
  const programs = await client.listLibraryPrograms(local.libraryId, signal);
  const orderedMemberships = orderMemberships(source.videos, input.programmingOrder);
  const lineup = mapPrograms(programs, orderedMemberships);
  if (!lineup.length) throw new AppError("TUNARR_NO_SCANNED_MEDIA", "Tunarr completed its scan but did not find any downloaded TunarrTube videos in this source directory.", 422);

  const [channels, transcodeConfigId] = await Promise.all([client.listChannels(signal), client.getDefaultTranscodeConfigId(signal)]);
  const existing = source.tunarrChannelId ? channels.find((channel) => channel.id === source.tunarrChannelId) : undefined;
  const occupied = new Set(channels.filter((channel) => channel.id !== existing?.id).map((channel) => channel.number));
  const number = input.channelNumber ?? existing?.number ?? Math.max(0, ...channels.map((channel) => channel.number)) + 1;
  if (occupied.has(number)) throw new AppError("TUNARR_CHANNEL_NUMBER_EXISTS", `Tunarr channel number ${number} is already in use.`, 409);
  let channelId = existing?.id ?? source.tunarrChannelId ?? randomUUID();
  const duration = lineup.reduce((total, program) => total + program.duration, 0);
  const payload = channelPayload(input, channelId, number, duration, transcodeConfigId, source.thumbnailUrl, existing);

  if (existing) {
    await client.updateChannel(channelId, payload, signal);
  } else {
    await db.source.update({ where: { id: source.id }, data: { tunarrChannelId: channelId, tunarrChannelNumber: number } });
    const created = await client.createChannel(payload, signal);
    channelId = created.id;
    await db.source.update({ where: { id: source.id }, data: { tunarrChannelId: channelId } });
  }
  await client.replaceProgramming(channelId, lineup, signal);
  const publishedAt = new Date();
  await db.source.update({ where: { id: source.id }, data: { tunarrChannelId: channelId, tunarrChannelNumber: number, tunarrLastPublishedAt: publishedAt, tunarrChannelName: input.channelName, tunarrRequestedChannelNumber: input.channelNumber ?? null, tunarrProgrammingOrder: input.programmingOrder } });
  await writeLog({ category: "tunarr", sourceId: source.id, message: `${existing ? "Updated" : "Created"} Tunarr channel ${input.channelName} (${number}) with ${lineup.length} program${lineup.length === 1 ? "" : "s"}.` });
  return { channelId, channelNumber: number, programCount: lineup.length, mediaSourceId: local.mediaSourceId, libraryId: local.libraryId, publishedAt };
}

export async function tunarrLinkStatus(sourceId: string, signal?: AbortSignal) {
  const source = await db.source.findUnique({ where: { id: sourceId } });
  if (!source) throw new AppError("SOURCE_NOT_FOUND", "Source not found.", 404);
  const client = new TunarrApiClient((await getSettings()).tunarrUrl);
  const [mediaSources, channels] = await Promise.all([client.listMediaSources(signal), client.listChannels(signal)]);
  const mapped = await translatePathForTunarr(source.mediaDirectory);
  const mediaSource = mediaSources.find((item) => item.id === source.tunarrMediaSourceId) ?? mediaSources.find((item) => item.type === "local" && item.paths?.some((value) => samePath(value, mapped)));
  const channel = channels.find((item) => item.id === source.tunarrChannelId);
  return { linked: Boolean(source.tunarrChannelId), mediaSourceFound: Boolean(mediaSource), libraryFound: Boolean(mediaSource?.libraries.some((item) => item.id === source.tunarrLibraryId)), channelFound: Boolean(channel), mappedDirectory: mapped, channel, candidates: channels.map((item) => ({ id: item.id, name: item.name, number: item.number })) };
}

export async function reconcileTunarrLink(sourceId: string, channelId?: string, signal?: AbortSignal) {
  const source = await db.source.findUnique({ where: { id: sourceId } });
  if (!source) throw new AppError("SOURCE_NOT_FOUND", "Source not found.", 404);
  const client = new TunarrApiClient((await getSettings()).tunarrUrl);
  const [mediaSources, channels] = await Promise.all([client.listMediaSources(signal), client.listChannels(signal)]);
  const mapped = await translatePathForTunarr(source.mediaDirectory);
  const media = mediaSources.find((item) => item.type === "local" && item.paths?.some((value) => samePath(value, mapped)));
  const selected = channelId ? channels.find((item) => item.id === channelId) : channels.find((item) => item.id === source.tunarrChannelId)
    ?? channels.filter((item) => item.name === source.tunarrChannelName && item.number === source.tunarrChannelNumber)[0];
  if (channelId && !selected) throw new AppError("TUNARR_CHANNEL_NOT_FOUND", "The selected Tunarr channel no longer exists.", 404);
  const library = media?.libraries.find((item) => item.enabled && (samePath(item.externalKey, mapped) || item.mediaType === "other_videos")) ?? media?.libraries[0];
  await db.source.update({ where: { id: sourceId }, data: { tunarrMediaSourceId: media?.id ?? source.tunarrMediaSourceId, tunarrLibraryId: library?.id ?? source.tunarrLibraryId, tunarrChannelId: selected?.id ?? source.tunarrChannelId, tunarrChannelNumber: selected?.number ?? source.tunarrChannelNumber, tunarrChannelName: selected?.name ?? source.tunarrChannelName } });
  return tunarrLinkStatus(sourceId, signal);
}

export async function unlinkTunarr(sourceId: string) {
  const source = await db.source.findUnique({ where: { id: sourceId }, include: { videos: true } });
  if (!source) throw new AppError("SOURCE_NOT_FOUND", "Source not found.", 404);
  for (const membership of source.videos.filter((item) => item.retentionOrigin === "tunarr")) {
    if (membership.localPath) {
      await rm(membership.localPath, { force: true });
      await rm(membership.localPath.replace(/\.mp4$/i, ".json"), { force: true });
      await rm(membership.localPath.replace(/\.mp4$/i, ".nfo"), { force: true });
    }
    await db.sourceVideo.update({ where: { id: membership.id }, data: { localPath: null, fileSize: null, downloadStatus: "not_downloaded", retentionOrigin: "none" } });
  }
  await db.source.update({ where: { id: sourceId }, data: { tunarrMediaSourceId: null, tunarrLibraryId: null, tunarrChannelId: null, tunarrChannelNumber: null, tunarrLastPublishedAt: null, tunarrChannelName: null, tunarrRequestedChannelNumber: null } });
  await writeLog({ category: "tunarr", sourceId, message: "Unlinked Tunarr without deleting remote objects." });
  return { unlinked: true };
}

export async function enqueueTunarrPublish(sourceId: string, input: PublishTunarrInput) {
  const source = await db.source.findUnique({ where: { id: sourceId }, select: { id: true } });
  if (!source) throw new AppError("SOURCE_NOT_FOUND", "Source not found.", 404);
  const job = await enqueueUniqueJob("tunarr_publish", sourceId, undefined, input);
  const { kickWorker } = await import("@/lib/jobs/runner");
  kickWorker();
  return job;
}
