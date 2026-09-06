// Publishes a curated, overlay-rendered Channel as its own Tunarr channel -- structurally the same
// "register local media source -> scan -> match by filename -> order lineup -> create/update
// channel -> replace programming" flow as lib/tunarr/service.ts:publishSourceToTunarr, but kept in
// its own file with its own small copies of the matching/ordering helpers rather than exporting (and
// so touching) that file's private ones. See lib/channels/materialize.ts for how a render gets onto
// disk in the channel's storage directory before this runs.
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { writeLog } from "@/lib/logging/service";
import { getSettings, translatePathForTunarr } from "@/lib/settings/service";
import { materializeRenderForChannel } from "@/lib/channels/materialize";
import { TunarrApiClient, type TunarrChannel, type TunarrProgram } from "@/lib/tunarr/client";

export type ChannelProgrammingOrder = "manual" | "oldest" | "newest" | "random";

function samePath(left: string, right: string) {
  return path.resolve(left) === path.resolve(right);
}

async function ensureLocalMediaSource(client: TunarrApiClient, channel: { id: string; name: string; storageDirectory: string; tunarrMediaSourceId: string | null }, signal?: AbortSignal) {
  const tunarrDirectory = await translatePathForTunarr(channel.storageDirectory);
  let mediaSources = await client.listMediaSources(signal);
  let mediaSource = mediaSources.find((candidate) => candidate.type === "local" && candidate.paths?.some((candidatePath) => samePath(candidatePath, tunarrDirectory)));
  if (!mediaSource) {
    const id = await client.createMusicVideoLocalMediaSource(`TunarrTube Channel - ${channel.name}`, tunarrDirectory, signal);
    mediaSources = await client.listMediaSources(signal);
    mediaSource = mediaSources.find((candidate) => candidate.id === id);
  }
  if (!mediaSource) throw new AppError("TUNARR_MEDIA_SOURCE_MISSING", "Tunarr did not return the newly created local media source.", 502);
  const library = mediaSource.libraries.find((candidate) => candidate.enabled && (samePath(candidate.externalKey, tunarrDirectory) || candidate.mediaType === "music_videos")) ?? mediaSource.libraries[0];
  if (!library) throw new AppError("TUNARR_LIBRARY_MISSING", "The Tunarr local media source has no library to scan.", 502);
  await db.channel.update({ where: { id: channel.id }, data: { tunarrMediaSourceId: mediaSource.id, tunarrLibraryId: library.id } });
  return { mediaSourceId: mediaSource.id, libraryId: library.id };
}

export function orderChannelItems<T extends { position: number }>(items: T[], order: ChannelProgrammingOrder) {
  const sorted = [...items];
  if (order === "manual") sorted.sort((a, b) => a.position - b.position);
  if (order === "random") {
    for (let index = sorted.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [sorted[index], sorted[swap]] = [sorted[swap], sorted[index]];
    }
  }
  return sorted;
}

export function mapPrograms(programs: TunarrProgram[], mediaItemIds: string[]) {
  const byBasename = new Map<string, TunarrProgram>();
  for (const program of programs) {
    const externalId = program.program?.externalId;
    if (typeof externalId !== "string") continue;
    byBasename.set(path.basename(externalId, path.extname(externalId)), program);
  }
  return mediaItemIds.flatMap((mediaItemId) => {
    const program = byBasename.get(mediaItemId);
    return program && program.duration > 0 ? [{ type: "content" as const, id: program.id, duration: program.duration }] : [];
  });
}

function channelPayload(name: string, id: string, number: number, duration: number, transcodeConfigId: string, iconPath: string | null, existing?: TunarrChannel) {
  return {
    id,
    name,
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
    icon: existing?.icon ?? { path: iconPath ?? "", width: 0, duration: 0, position: "bottom-right" },
    offline: existing?.offline ?? { mode: "pic" },
    ...(Array.isArray(existing?.fillerCollections) ? { fillerCollections: existing.fillerCollections } : {}),
    ...(typeof existing?.fillerRepeatCooldown === "number" ? { fillerRepeatCooldown: existing.fillerRepeatCooldown } : {}),
    ...(typeof existing?.guideFlexTitle === "string" ? { guideFlexTitle: existing.guideFlexTitle } : {}),
    // Deliberately never *constructed* here: Tunarr's watermark JSON shape isn't published, so the
    // supported path is "set it once by hand in Tunarr's own channel-edit UI" -- this passthrough is
    // what makes that survive every future publish untouched.
    ...(existing?.watermark ? { watermark: existing.watermark } : {}),
    ...(existing?.onDemand ? { onDemand: existing.onDemand } : {}),
    ...(Array.isArray(existing?.subtitlePreferences) ? { subtitlePreferences: existing.subtitlePreferences } : {})
  };
}

export async function publishChannelToTunarr(channelId: string, signal?: AbortSignal) {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    include: { items: { orderBy: { position: "asc" }, include: { mediaItem: true } }, template: true }
  });
  if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Channel not found.", 404);
  if (!channel.items.length) throw new AppError("TUNARR_NO_MEDIA", "Add at least one media item to this channel before publishing.", 422);

  const renders = await db.renderedAsset.findMany({
    where: { templateId: channel.templateId, mediaItemId: { in: channel.items.map((item) => item.mediaItemId) } }
  });
  const renderByMediaItem = new Map(renders.map((render) => [render.mediaItemId, render]));
  const unrendered = channel.items.filter((item) => renderByMediaItem.get(item.mediaItemId)?.status !== "complete");
  if (unrendered.length) {
    throw new AppError(
      "TUNARR_UNRENDERED_ITEMS",
      `Render these items with the channel's template before publishing: ${unrendered.map((item) => item.mediaItem.title).join(", ")}.`,
      422
    );
  }

  const ordered = orderChannelItems(channel.items, channel.programmingOrder as ChannelProgrammingOrder);
  for (const item of ordered) {
    const render = renderByMediaItem.get(item.mediaItemId)!;
    await materializeRenderForChannel(channel.storageDirectory, item.mediaItem, render);
  }

  const settings = await getSettings();
  const client = new TunarrApiClient(settings.tunarrUrl);
  const discovery = await client.discover(signal);
  const missing = Object.entries(discovery.capabilities).filter(([, supported]) => !supported).map(([name]) => name);
  if (missing.length) throw new AppError("TUNARR_UNSUPPORTED_API", `Tunarr ${discovery.openApiVersion ?? "server"} is missing required API capabilities: ${missing.join(", ")}.`, 422);

  const local = await ensureLocalMediaSource(client, channel, signal);
  const mediaItemIds = ordered.map((item) => item.mediaItemId);
  await client.scanLibrary(local.mediaSourceId, local.libraryId, signal);
  await client.waitForLibraryScan(local.mediaSourceId, local.libraryId, signal, async () => {
    const indexedPrograms = await client.listLibraryPrograms(local.libraryId, signal);
    return mapPrograms(indexedPrograms, mediaItemIds).length === mediaItemIds.length;
  });
  const programs = await client.listLibraryPrograms(local.libraryId, signal);
  const lineup = mapPrograms(programs, mediaItemIds);
  if (!lineup.length) throw new AppError("TUNARR_NO_SCANNED_MEDIA", "Tunarr completed its scan but did not find any of this channel's rendered videos.", 422);

  const [channels, transcodeConfigId] = await Promise.all([client.listChannels(signal), client.getDefaultTranscodeConfigId(signal)]);
  const existing = channel.tunarrChannelId ? channels.find((candidate) => candidate.id === channel.tunarrChannelId) : undefined;
  const occupied = new Set(channels.filter((candidate) => candidate.id !== existing?.id).map((candidate) => candidate.number));
  const number = channel.tunarrRequestedChannelNumber ?? existing?.number ?? Math.max(0, ...channels.map((candidate) => candidate.number)) + 1;
  if (occupied.has(number)) throw new AppError("TUNARR_CHANNEL_NUMBER_EXISTS", `Tunarr channel number ${number} is already in use.`, 409);

  let channelIdOnTunarr = existing?.id ?? channel.tunarrChannelId ?? randomUUID();
  const duration = lineup.reduce((total, program) => total + program.duration, 0);
  const payload = channelPayload(channel.name, channelIdOnTunarr, number, duration, transcodeConfigId, channel.logoAssetPath, existing);

  if (existing) {
    await client.updateChannel(channelIdOnTunarr, payload, signal);
  } else {
    const created = await client.createChannel(payload, signal);
    channelIdOnTunarr = created.id;
  }
  await client.replaceProgramming(channelIdOnTunarr, lineup, signal);

  const publishedAt = new Date();
  await db.channel.update({
    where: { id: channel.id },
    data: { tunarrChannelId: channelIdOnTunarr, tunarrChannelNumber: number, tunarrChannelName: channel.name, tunarrLastPublishedAt: publishedAt }
  });
  await writeLog({ category: "tunarr", channelId: channel.id, message: `${existing ? "Updated" : "Created"} Tunarr channel "${channel.name}" (${number}) with ${lineup.length} program${lineup.length === 1 ? "" : "s"}.` });
  return { channelId: channelIdOnTunarr, channelNumber: number, programCount: lineup.length, mediaSourceId: local.mediaSourceId, libraryId: local.libraryId, publishedAt };
}

export async function channelTunarrLinkStatus(channelId: string, signal?: AbortSignal) {
  const channel = await db.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Channel not found.", 404);
  const client = new TunarrApiClient((await getSettings()).tunarrUrl);
  const [mediaSources, channels] = await Promise.all([client.listMediaSources(signal), client.listChannels(signal)]);
  const directory = await translatePathForTunarr(channel.storageDirectory);
  const mediaSource = mediaSources.find((item) => item.id === channel.tunarrMediaSourceId) ?? mediaSources.find((item) => item.type === "local" && item.paths?.some((value) => samePath(value, directory)));
  const tunarrChannel = channels.find((item) => item.id === channel.tunarrChannelId);
  return {
    linked: Boolean(channel.tunarrChannelId),
    mediaSourceFound: Boolean(mediaSource),
    libraryFound: Boolean(mediaSource?.libraries.some((item) => item.id === channel.tunarrLibraryId)),
    channelFound: Boolean(tunarrChannel),
    channel: tunarrChannel,
    candidates: channels.map((item) => ({ id: item.id, name: item.name, number: item.number }))
  };
}

export async function unlinkChannelFromTunarr(channelId: string) {
  const channel = await db.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Channel not found.", 404);
  await db.channel.update({
    where: { id: channelId },
    data: { tunarrMediaSourceId: null, tunarrLibraryId: null, tunarrChannelId: null, tunarrChannelNumber: null, tunarrLastPublishedAt: null, tunarrChannelName: null }
  });
  await writeLog({ category: "tunarr", channelId, message: "Unlinked Tunarr without deleting remote objects." });
  return { unlinked: true };
}
