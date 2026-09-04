import path from "node:path";
import { mkdir, realpath, access } from "node:fs/promises";
import { constants } from "node:fs";
import { AppError } from "@/lib/api";
import { DEFAULT_MEDIA_ROOT } from "@/lib/constants";
import { db } from "@/lib/db/client";
import { writeLog } from "@/lib/logging/service";

export async function validateMediaDirectory(input: string, create = true) {
  if (!path.isAbsolute(input)) throw new AppError("INVALID_MEDIA_DIRECTORY", "Media directory must be an absolute path.");
  if (create) await mkdir(input, { recursive: true });
  try {
    await access(input, constants.R_OK | constants.W_OK);
    return await realpath(input);
  } catch {
    throw new AppError("INVALID_MEDIA_DIRECTORY", "Media directory must exist and be readable and writable.");
  }
}

export async function getSettings() {
  const existing = await db.appSettings.findUnique({ where: { id: 1 } });
  if (existing) {
    const mediaBaseDirectory = await validateMediaDirectory(existing.mediaBaseDirectory);
    return mediaBaseDirectory === existing.mediaBaseDirectory
      ? existing
      : db.appSettings.update({ where: { id: 1 }, data: { mediaBaseDirectory } });
  }
  const configured = process.env.YTARR_MEDIA_DIR ?? DEFAULT_MEDIA_ROOT;
  const mediaBaseDirectory = await validateMediaDirectory(configured);
  const tunarrUrl = normalizeTunarrUrl(process.env.YTARR_TUNARR_URL ?? "http://127.0.0.1:8000");
  return db.appSettings.create({ data: { id: 1, mediaBaseDirectory, tunarrUrl } });
}

export async function getSettingsView() {
  const [settings, pathMappings] = await Promise.all([getSettings(), db.tunarrPathMapping.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] })]);
  return { ...settings, pathMappings };
}

export function normalizeTunarrUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError("INVALID_TUNARR_URL", "Tunarr URL must be a valid HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new AppError("INVALID_TUNARR_URL", "Tunarr URL must be an HTTP or HTTPS base URL without credentials, query parameters, or a fragment.");
  }
  return url.toString().replace(/\/$/, "");
}

export async function updateSettings(input: { mediaBaseDirectory?: string; tunarrUrl?: string; cacheMaxMegabytes?: number; cacheMaxAgeDays?: number; defaultVideoQuality?: string; pathMappings?: Array<{ ytarrPrefix: string; tunarrPrefix: string }> }) {
  const current = await getSettings();
  const valid = input.mediaBaseDirectory
    ? await validateMediaDirectory(input.mediaBaseDirectory)
    : current.mediaBaseDirectory;
  const tunarrUrl = input.tunarrUrl ? normalizeTunarrUrl(input.tunarrUrl) : current.tunarrUrl;
  const mappings = input.pathMappings ? input.pathMappings.map((mapping, position) => {
    if (!path.isAbsolute(mapping.ytarrPrefix) || !path.isAbsolute(mapping.tunarrPrefix)) throw new AppError("INVALID_PATH_MAPPING", "Both mapping prefixes must be absolute paths.");
    return { ytarrPrefix: path.normalize(mapping.ytarrPrefix), tunarrPrefix: path.normalize(mapping.tunarrPrefix), position };
  }) : null;
  if (mappings && new Set(mappings.map((mapping) => mapping.ytarrPrefix)).size !== mappings.length) throw new AppError("DUPLICATE_PATH_MAPPING", "YTarr mapping prefixes must be unique.");
  const sources = await db.source.findMany({ select: { id: true, directoryName: true } });
  const destinations = sources.map((source) => ({
    ...source,
    mediaDirectory: path.join(/* turbopackIgnore: true */ valid, source.directoryName)
  }));
  await Promise.all(destinations.map((source) => mkdir(source.mediaDirectory, { recursive: true })));
  const settings = await db.$transaction(async (tx) => {
    const saved = await tx.appSettings.upsert({
      where: { id: 1 },
      update: { mediaBaseDirectory: valid, tunarrUrl, cacheMaxMegabytes: input.cacheMaxMegabytes, cacheMaxAgeDays: input.cacheMaxAgeDays, defaultVideoQuality: input.defaultVideoQuality },
      create: { id: 1, mediaBaseDirectory: valid, tunarrUrl, cacheMaxMegabytes: input.cacheMaxMegabytes, cacheMaxAgeDays: input.cacheMaxAgeDays, defaultVideoQuality: input.defaultVideoQuality }
    });
    for (const source of destinations) {
      await tx.source.update({ where: { id: source.id }, data: { mediaDirectory: source.mediaDirectory } });
    }
    if (mappings) {
      await tx.tunarrPathMapping.deleteMany();
      for (const mapping of mappings) await tx.tunarrPathMapping.create({ data: mapping });
    }
    return saved;
  });
  await writeLog({ category: "settings", message: `Settings saved. Media directory: ${valid}; Tunarr: ${tunarrUrl}. Updated ${sources.length} source destination${sources.length === 1 ? "" : "s"}.` });
  return { ...settings, pathMappings: await db.tunarrPathMapping.findMany({ orderBy: { position: "asc" } }), updatedSources: sources.length };
}

export function translatePathWithMappings(input: string, mappings: Array<{ ytarrPrefix: string; tunarrPrefix: string }>) {
  const normalized = path.resolve(input);
  if (!mappings.length) return normalized;
  const matches = mappings.flatMap((mapping) => {
    const prefix = path.resolve(mapping.ytarrPrefix);
    const relative = path.relative(prefix, normalized);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? [{ ...mapping, prefix, relative }] : [];
  }).sort((left, right) => right.prefix.length - left.prefix.length);
  const match = matches[0];
  if (!match) throw new AppError("TUNARR_PATH_UNMAPPED", `No Tunarr path mapping covers ${input}.`, 422);
  return path.posix.join(match.tunarrPrefix.replaceAll("\\", "/"), match.relative.replaceAll("\\", "/"));
}

export async function translatePathForTunarr(input: string) {
  const mappings = await db.tunarrPathMapping.findMany({ orderBy: { position: "asc" } });
  return translatePathWithMappings(input, mappings);
}

export async function assertWithinDirectory(base: string, target: string) {
  const basePath = await realpath(base);
  const targetParent = await realpath(path.dirname(target));
  const resolvedTarget = path.join(targetParent, path.basename(target));
  const relative = path.relative(basePath, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AppError("UNSAFE_PATH", "The requested path is outside the configured media directory.", 400);
  }
  return resolvedTarget;
}
