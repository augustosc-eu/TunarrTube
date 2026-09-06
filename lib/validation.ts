import { z } from "zod";
import { VIDEO_QUALITIES } from "@/lib/youtube/quality";

export const videoQualitySchema = z.enum(VIDEO_QUALITIES);

export const analyzeSourceSchema = z.object({
  url: z.string().url(),
  feedType: z.enum(["videos", "shorts", "live", "all"]).optional(),
  historyLimit: z.number().int().min(1).max(5000).nullable().optional()
});

export const createSourceSchema = z.object({
  draftId: z.string().min(1),
  name: z.string().trim().min(1).max(160).optional(),
  playbackMode: z.enum(["download", "cache", "stream"]).default("download"),
  videoQuality: videoQualitySchema.nullable().optional(),
  syncEnabled: z.boolean().default(false),
  syncIntervalMinutes: z.number().int().min(15).max(43_200).default(360)
});

export const addCollectionVideosSchema = z.object({
  urls: z.array(z.string().trim().url()).min(1).max(50)
});

export const patchSourceSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  playbackMode: z.enum(["download", "cache", "stream"]).optional(),
  videoQuality: videoQualitySchema.nullable().optional(),
  syncEnabled: z.boolean().optional(),
  syncIntervalMinutes: z.number().int().min(15).max(43_200).optional()
}).refine((input) => Object.keys(input).length > 0, { message: "At least one source setting is required." });

export const downloadSchema = z.object({
  items: z.array(
    z.object({ sourceId: z.string().min(1), videoId: z.string().min(1) })
  ).min(1).max(100)
});

export const settingsSchema = z.object({
  mediaBaseDirectory: z.string().trim().min(1).optional(),
  tunarrUrl: z.string().trim().url().optional(),
  cacheMaxMegabytes: z.number().int().min(128).max(10_000_000).optional(),
  cacheMaxAgeDays: z.number().int().min(1).max(3650).optional(),
  logRetentionDays: z.number().int().min(1).max(3650).optional(),
  defaultVideoQuality: videoQualitySchema.optional(),
  musicbrainzContactEmail: z.string().trim().email().nullable().optional(),
  pathMappings: z.array(z.object({ ytarrPrefix: z.string().trim().min(1), tunarrPrefix: z.string().trim().min(1) })).max(50).optional()
}).refine((input) => Object.values(input).some((value) => value !== undefined), {
  message: "At least one setting is required."
});

export const publishTunarrSchema = z.object({
  channelName: z.string().trim().min(1).max(160),
  channelNumber: z.number().int().positive().optional(),
  programmingOrder: z.enum(["playlist", "oldest", "newest", "random"]).default("playlist")
});

export const testTunarrSchema = z.object({ tunarrUrl: z.string().trim().url() });

export const preparePlaybackSchema = z.object({ sourceId: z.string().min(1), videoId: z.string().min(1) });
export const cacheMutationSchema = z.object({ action: z.enum(["pin", "unpin", "evict"]) });
export const jobMutationSchema = z.object({
  action: z.enum(["cancel", "retry", "stop", "postpone"]),
  postponeMinutes: z.number().int().min(1).max(60 * 24 * 30).optional()
}).refine((input) => input.action !== "postpone" || input.postponeMinutes !== undefined, {
  message: "postponeMinutes is required to postpone a job.",
  path: ["postponeMinutes"]
});
export const jobsPauseSchema = z.object({ paused: z.boolean() });
export const cacheEnforceSchema = z.object({ action: z.enum(["enforce", "clear"]).default("enforce") });
export const logsPurgeSchema = z.object({ action: z.enum(["purge", "clear"]).default("purge") });
export const reconcileTunarrSchema = z.object({ channelId: z.string().min(1).optional() });

// --- Channel-generator domain: curated, overlay-rendered channels ---------------------------------

export const createChannelSchema = z.object({
  name: z.string().trim().min(1).max(160),
  templateId: z.string().min(1)
});

export const updateChannelSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  templateId: z.string().min(1).optional(),
  programmingOrder: z.enum(["manual", "oldest", "newest", "random"]).optional(),
  logoAssetPath: z.string().trim().min(1).nullable().optional(),
  tunarrRequestedChannelNumber: z.number().int().positive().nullable().optional()
}).refine((input) => Object.keys(input).length > 0, { message: "At least one channel setting is required." });

export const addLocalFolderSchema = z.object({ type: z.literal("local"), folder: z.string().trim().min(1) });
export const addYoutubeUrlItemSchema = z.object({ type: z.literal("youtube"), url: z.string().trim().url() });
// The "pick an already-downloaded video" convenience: sourceVideoId identifies the exact
// (Source, Video) pairing to render from -- see lib/channels/service.ts:attachExistingVideo.
export const addExistingVideoSchema = z.object({ type: z.literal("existingVideo"), sourceVideoId: z.string().min(1) });
export const addChannelItemSchema = z.discriminatedUnion("type", [addLocalFolderSchema, addYoutubeUrlItemSchema, addExistingVideoSchema]);

export const reorderChannelItemsSchema = z.object({ mediaItemIds: z.array(z.string().min(1)).min(1) });

export const updateMediaItemSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  artist: z.string().trim().max(300).nullable().optional(),
  album: z.string().trim().max(300).nullable().optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  genre: z.string().trim().max(120).nullable().optional(),
  releaseDate: z.string().trim().nullable().optional(),
  // Arbitrary key->string overrides for binding keys the assigned template declares that aren't
  // one of the columns above (e.g. the news template's "ticker") -- see resolveBindingValues in
  // lib/overlay/service.ts. Stored pre-serialized, same convention as
  // OverlayTemplate.bindingsJson/layersJson.
  customFieldsJson: z.string().max(20_000).nullable().optional()
}).refine((input) => Object.keys(input).length > 0, { message: "At least one metadata field is required." });

export const metadataCandidateSchema = z.object({
  provider: z.enum(["musicbrainz", "itunes"]),
  externalId: z.string().min(1),
  title: z.string().min(1),
  artist: z.string().optional(),
  album: z.string().optional(),
  year: z.number().optional(),
  releaseDate: z.string().optional(),
  artUrl: z.string().nullable().optional(),
  score: z.number()
});

export const renderMediaItemSchema = z.object({ templateId: z.string().min(1) });

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  channelType: z.string().trim().min(1).max(60).default("music_video"),
  description: z.string().trim().max(500).optional(),
  htmlTemplate: z.string().min(1),
  bindingsJson: z.string().min(1),
  layersJson: z.string().min(1),
  // Present only while the template is authored/editable via the visual builder -- see
  // lib/overlay/visual.ts and components/template-editor.tsx.
  visualLayoutJson: z.string().min(1).nullable().optional()
});

export const updateTemplateSchema = createTemplateSchema.partial().refine((input) => Object.keys(input).length > 0, { message: "At least one template field is required." });
