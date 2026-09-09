import { z } from "zod";
import { VIDEO_QUALITIES } from "@/lib/youtube/quality";
import { AI_PROVIDERS, SCHEDULE_STYLES } from "@/lib/programming/types";
import { NAMING_SCHEMES } from "@/lib/naming/service";

export const videoQualitySchema = z.enum(VIDEO_QUALITIES);
// A per-Source filenameTemplate is only meaningful for namingScheme "template" -- "id"/"tvshow" ignore
// it -- but it's still validated/stored regardless of scheme so switching schemes doesn't lose it.
export const namingSchemeSchema = z.enum(NAMING_SCHEMES);
export const filenameTemplateSchema = z.string().trim().min(1).max(300);
// "auto" is only valid for the global AppSettings default -- a per-Source/Channel override must name a
// concrete provider (or be cleared back to null/"auto" to fall back to the global setting).
export const aiProviderSettingSchema = z.enum([...AI_PROVIDERS, "auto"]);
export const aiProviderOverrideSchema = z.enum(AI_PROVIDERS).nullable();
export const aiProgrammingInstructionsSchema = z.string().trim().max(4_000).nullable();
export const aiScheduleStyleSchema = z.enum(SCHEDULE_STYLES).nullable();

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
  syncIntervalMinutes: z.number().int().min(15).max(43_200).default(360),
  // null on either means "inherit AppSettings.defaultNamingScheme/defaultFilenameTemplate" -- see
  // lib/naming/service.ts.
  namingScheme: namingSchemeSchema.nullable().optional(),
  filenameTemplate: filenameTemplateSchema.nullable().optional()
});

export const addCollectionVideosSchema = z.object({
  urls: z.array(z.string().trim().url()).min(1).max(50)
});

export const patchSourceSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  playbackMode: z.enum(["download", "cache", "stream"]).optional(),
  videoQuality: videoQualitySchema.nullable().optional(),
  syncEnabled: z.boolean().optional(),
  syncIntervalMinutes: z.number().int().min(15).max(43_200).optional(),
  namingScheme: namingSchemeSchema.nullable().optional(),
  filenameTemplate: filenameTemplateSchema.nullable().optional()
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
  metadataMusicbrainzEnabled: z.boolean().optional(),
  metadataItunesEnabled: z.boolean().optional(),
  metadataAutoApplyThreshold: z.number().int().min(0).max(100).optional(),
  aiProvider: aiProviderSettingSchema.optional(),
  ytdlpCookiesPath: z.string().trim().min(1).nullable().optional(),
  pathMappings: z.array(z.object({ ytarrPrefix: z.string().trim().min(1), tunarrPrefix: z.string().trim().min(1) })).max(50).optional(),
  defaultNamingScheme: namingSchemeSchema.optional(),
  defaultFilenameTemplate: filenameTemplateSchema.optional()
}).refine((input) => Object.values(input).some((value) => value !== undefined), {
  message: "At least one setting is required."
});

export const publishTunarrSchema = z.object({
  channelName: z.string().trim().min(1).max(160),
  channelNumber: z.number().int().positive().optional(),
  programmingOrder: z.enum(["playlist", "oldest", "newest", "random", "ai"]).default("playlist"),
  // Only meaningful (and only persisted -- see lib/tunarr/service.ts:publishSourceToTunarr) when
  // programmingOrder is "ai". aiProvider/aiScheduleStyle omitted/undefined leave the Source's stored
  // value alone; pass null explicitly to clear either back to its default.
  aiInstructions: aiProgrammingInstructionsSchema.optional(),
  aiProvider: aiProviderOverrideSchema.optional(),
  aiScheduleStyle: aiScheduleStyleSchema.optional()
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
  programmingOrder: z.enum(["manual", "oldest", "newest", "random", "ai"]).optional(),
  logoAssetPath: z.string().trim().min(1).nullable().optional(),
  tunarrRequestedChannelNumber: z.number().int().positive().nullable().optional(),
  // Only meaningful when programmingOrder is (or is already) "ai" -- see the matching Source fields on
  // publishTunarrSchema above.
  aiProgrammingInstructions: aiProgrammingInstructionsSchema.optional(),
  aiProvider: aiProviderOverrideSchema.optional(),
  aiScheduleStyle: aiScheduleStyleSchema.optional()
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

export const selectChannelContentSchema = z.object({
  sourceIds: z.array(z.string().min(1)).min(1).max(20),
  instructions: z.string().trim().min(1).max(4_000),
  targetCount: z.number().int().min(1).max(200).optional(),
  aiProvider: aiProviderOverrideSchema.optional()
});

export const createChannelFromBriefSchema = z.object({
  name: z.string().trim().min(1).max(160),
  templateId: z.string().min(1),
  brief: z.string().trim().min(1).max(4_000),
  sourceIds: z.array(z.string().min(1)).min(1).max(20),
  scheduleStyle: aiScheduleStyleSchema.optional(),
  aiProvider: aiProviderOverrideSchema.optional()
});

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  channelType: z.string().trim().min(1).max(60).default("music_video"),
  description: z.string().trim().max(500).optional(),
  // The visual builder's client-side MAX_IMAGE_BYTES (components/template-visual-editor.tsx, 3MB
  // raw -> ~4MB as a base64 data: URI) only guards the UI -- a direct API call bypasses it entirely,
  // so these two need their own server-side ceiling. Generous enough for several embedded images
  // (htmlTemplate and visualLayoutJson each carry their own copy of every image's data: URI) while
  // still bounding how much arbitrary text one template row can force into the DB.
  htmlTemplate: z.string().min(1).max(8_000_000),
  bindingsJson: z.string().min(1).max(100_000),
  layersJson: z.string().min(1).max(100_000),
  // Present only while the template is authored/editable via the visual builder -- see
  // lib/overlay/visual.ts and components/template-editor.tsx.
  visualLayoutJson: z.string().min(1).max(8_000_000).nullable().optional()
});

export const updateTemplateSchema = createTemplateSchema.partial().refine((input) => Object.keys(input).length > 0, { message: "At least one template field is required." });
