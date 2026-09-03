import { z } from "zod";

export const analyzeSourceSchema = z.object({
  url: z.string().url(),
  feedType: z.enum(["videos", "shorts", "live", "all"]).optional(),
  historyLimit: z.number().int().min(1).max(5000).nullable().optional()
});

export const createSourceSchema = z.object({
  draftId: z.string().min(1),
  name: z.string().trim().min(1).max(160).optional(),
  playbackMode: z.enum(["download", "cache", "stream"]).default("download"),
  syncEnabled: z.boolean().default(false),
  syncIntervalMinutes: z.number().int().min(15).max(43_200).default(360)
});

export const patchSourceSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  playbackMode: z.enum(["download", "cache", "stream"]).optional(),
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
export const cacheEnforceSchema = z.object({ action: z.enum(["enforce", "clear"]).default("enforce") });
export const reconcileTunarrSchema = z.object({ channelId: z.string().min(1).optional() });
