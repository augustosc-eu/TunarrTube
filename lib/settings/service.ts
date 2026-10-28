import path from "node:path";
import { mkdir, realpath, access, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { AppError } from "@/lib/api";
import { readEnv } from "@/lib/config/env";
import { DEFAULT_MEDIA_ROOT } from "@/lib/constants";
import { db } from "@/lib/db/client";
import { writeLog } from "@/lib/logging/service";
import { SITES, type SiteId } from "@/lib/youtube/sites";

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

// Only called from updateSettings() below, when a user explicitly sets/changes the path via Settings --
// not from getSettings()'s env-seeded initial create, so a not-yet-mounted cookies file at container
// startup doesn't take the whole app down the way an invalid media directory would. If the file goes
// missing later (a bind mount unmounts, etc.), yt-dlp's own "could not find cookies file" error surfaces
// through the normal job-failure path instead.
export async function validateCookiesPath(input: string) {
  if (!path.isAbsolute(input)) throw new AppError("INVALID_COOKIES_PATH", "Cookies file path must be absolute.");
  try {
    await access(input, constants.R_OK);
  } catch {
    throw new AppError("INVALID_COOKIES_PATH", "Cookies file must exist and be readable.");
  }
  return input;
}

// Same convention as validateCookiesPath above: only called from updateSettings() when the operator
// explicitly sets/changes this path, not from getSettings()'s initial create, so a not-yet-installed
// Claude Code binary never blocks the app from starting. Unlike ytdlpCookiesPath this is optional even
// when set -- most installs leave it null and rely on lib/ai/claude-code.ts's own PATH auto-detection;
// this exists only for the rare case where that detection picks the wrong (or no) binary.
export async function validateClaudeCodePath(input: string) {
  if (!path.isAbsolute(input)) throw new AppError("INVALID_CLAUDE_CODE_PATH", "Claude Code executable path must be absolute.");
  try {
    await access(input, constants.X_OK);
  } catch {
    throw new AppError("INVALID_CLAUDE_CODE_PATH", "Claude Code executable must exist and be executable at that path.");
  }
  return input;
}

export async function getSettings() {
  const existing = await db.appSettings.findUnique({ where: { id: 1 } });
  if (existing) return reconcileMediaDirectory(existing);

  const configured = readEnv("MEDIA_DIR") ?? DEFAULT_MEDIA_ROOT;
  const mediaBaseDirectory = await validateMediaDirectory(configured);
  const tunarrUrl = normalizeTunarrUrl(readEnv("TUNARR_URL") ?? "http://127.0.0.1:8000");
  // Not validated here (unlike mediaBaseDirectory/tunarrUrl above) -- see validateCookiesPath's comment.
  const ytdlpCookiesPath = readEnv("YTDLP_COOKIES") ?? null;
  // Atomic create-or-fetch: concurrent callers (instrumentation.ts's kickWorker()/startScheduler(), plus
  // any early request) can all reach this branch together at startup, before any row exists. upsert with
  // a no-op `update` resolves that race at the DB layer -- every loser gets the winner's row back --
  // instead of racing appSettings.create() and having Prisma log a unique-constraint error per loser.
  const settings = await db.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, mediaBaseDirectory, tunarrUrl, ytdlpCookiesPath } });
  return reconcileMediaDirectory(settings);
}

async function reconcileMediaDirectory(settings: Awaited<ReturnType<typeof db.appSettings.findUniqueOrThrow>>) {
  const mediaBaseDirectory = await validateMediaDirectory(settings.mediaBaseDirectory);
  return mediaBaseDirectory === settings.mediaBaseDirectory
    ? settings
    : db.appSettings.update({ where: { id: 1 }, data: { mediaBaseDirectory } });
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

export function isAbsoluteTunarrPath(input: string) {
  return path.posix.isAbsolute(input) || isWindowsAbsolutePath(input);
}

function isWindowsAbsolutePath(input: string) {
  return /^[a-zA-Z]:[\\/]/.test(input) || input.startsWith("\\\\");
}

function joinTunarrPath(prefix: string, relative: string) {
  return isWindowsAbsolutePath(prefix)
    ? path.win32.join(prefix, ...relative.split(path.sep))
    : path.posix.join(prefix, relative.replaceAll("\\", "/"));
}

export async function updateSettings(input: { mediaBaseDirectory?: string; tunarrUrl?: string; cacheMaxMegabytes?: number; cacheMaxAgeDays?: number; logRetentionDays?: number; defaultVideoQuality?: string; musicbrainzContactEmail?: string | null; metadataMusicbrainzEnabled?: boolean; metadataItunesEnabled?: boolean; metadataAutoApplyThreshold?: number; aiProvider?: string; aiClaudeCodeEnabled?: boolean; aiClaudeCodePath?: string | null; aiClaudeCodeTimeoutSeconds?: number; ytdlpCookiesPath?: string | null; pathMappings?: Array<{ tunarrtubePrefix: string; tunarrPrefix: string }>; defaultNamingScheme?: string; defaultFilenameTemplate?: string }) {
  const current = await getSettings();
  const valid = input.mediaBaseDirectory
    ? await validateMediaDirectory(input.mediaBaseDirectory)
    : current.mediaBaseDirectory;
  const tunarrUrl = input.tunarrUrl ? normalizeTunarrUrl(input.tunarrUrl) : current.tunarrUrl;
  // undefined = leave the stored path alone, null = explicitly clear it back to unauthenticated, a string
  // = validate and replace it (see validateCookiesPath's comment on why this validates, unlike getSettings'
  // env-seeded default).
  const ytdlpCookiesPath = input.ytdlpCookiesPath === undefined
    ? undefined
    : input.ytdlpCookiesPath === null ? null : await validateCookiesPath(input.ytdlpCookiesPath);
  const aiClaudeCodePath = input.aiClaudeCodePath === undefined
    ? undefined
    : input.aiClaudeCodePath === null ? null : await validateClaudeCodePath(input.aiClaudeCodePath);
  const mappings = input.pathMappings ? input.pathMappings.map((mapping, position) => {
    if (!path.isAbsolute(mapping.tunarrtubePrefix) || !isAbsoluteTunarrPath(mapping.tunarrPrefix)) {
      throw new AppError("INVALID_PATH_MAPPING", "The TunarrTube prefix must be absolute on this host, and the Tunarr prefix must be an absolute Unix or Windows path.");
    }
    const tunarrPrefix = isWindowsAbsolutePath(mapping.tunarrPrefix)
      ? path.win32.normalize(mapping.tunarrPrefix)
      : path.posix.normalize(mapping.tunarrPrefix);
    return { tunarrtubePrefix: path.normalize(mapping.tunarrtubePrefix), tunarrPrefix, position };
  }) : null;
  if (mappings && new Set(mappings.map((mapping) => mapping.tunarrtubePrefix)).size !== mappings.length) throw new AppError("DUPLICATE_PATH_MAPPING", "TunarrTube mapping prefixes must be unique.");
  const sources = await db.source.findMany({ select: { id: true, directoryName: true } });
  const destinations = sources.map((source) => ({
    ...source,
    mediaDirectory: path.join(/* turbopackIgnore: true */ valid, source.directoryName)
  }));
  await Promise.all(destinations.map((source) => mkdir(source.mediaDirectory, { recursive: true })));
  const settings = await db.$transaction(async (tx) => {
    const saved = await tx.appSettings.upsert({
      where: { id: 1 },
      update: { mediaBaseDirectory: valid, tunarrUrl, cacheMaxMegabytes: input.cacheMaxMegabytes, cacheMaxAgeDays: input.cacheMaxAgeDays, logRetentionDays: input.logRetentionDays, defaultVideoQuality: input.defaultVideoQuality, musicbrainzContactEmail: input.musicbrainzContactEmail, metadataMusicbrainzEnabled: input.metadataMusicbrainzEnabled, metadataItunesEnabled: input.metadataItunesEnabled, metadataAutoApplyThreshold: input.metadataAutoApplyThreshold, aiProvider: input.aiProvider, aiClaudeCodeEnabled: input.aiClaudeCodeEnabled, aiClaudeCodePath, aiClaudeCodeTimeoutSeconds: input.aiClaudeCodeTimeoutSeconds, ytdlpCookiesPath, defaultNamingScheme: input.defaultNamingScheme, defaultFilenameTemplate: input.defaultFilenameTemplate },
      create: { id: 1, mediaBaseDirectory: valid, tunarrUrl, cacheMaxMegabytes: input.cacheMaxMegabytes, cacheMaxAgeDays: input.cacheMaxAgeDays, logRetentionDays: input.logRetentionDays, defaultVideoQuality: input.defaultVideoQuality, musicbrainzContactEmail: input.musicbrainzContactEmail, metadataMusicbrainzEnabled: input.metadataMusicbrainzEnabled, metadataItunesEnabled: input.metadataItunesEnabled, metadataAutoApplyThreshold: input.metadataAutoApplyThreshold, aiProvider: input.aiProvider, aiClaudeCodeEnabled: input.aiClaudeCodeEnabled, aiClaudeCodePath: aiClaudeCodePath ?? null, aiClaudeCodeTimeoutSeconds: input.aiClaudeCodeTimeoutSeconds, ytdlpCookiesPath: ytdlpCookiesPath ?? null, defaultNamingScheme: input.defaultNamingScheme, defaultFilenameTemplate: input.defaultFilenameTemplate }
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

export function translatePathWithMappings(input: string, mappings: Array<{ tunarrtubePrefix: string; tunarrPrefix: string }>) {
  const normalized = path.resolve(input);
  if (!mappings.length) return normalized;
  const matches = mappings.flatMap((mapping) => {
    const prefix = path.resolve(mapping.tunarrtubePrefix);
    const relative = path.relative(prefix, normalized);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? [{ ...mapping, prefix, relative }] : [];
  }).sort((left, right) => right.prefix.length - left.prefix.length);
  const match = matches[0];
  if (!match) throw new AppError("TUNARR_PATH_UNMAPPED", `No Tunarr path mapping covers ${input}.`, 422);
  return joinTunarrPath(match.tunarrPrefix, match.relative);
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

// Deletion counterpart of assertWithinDirectory: removes `target` only when it resolves inside one of
// `roots` -- the same directory the file was originally written under. Every caller deletes a path read
// back from the DB, so a hand-edited row or a moved directory must never turn a cleanup into deleting
// something unrelated: such a path is skipped and logged instead. A target (or root) that no longer
// exists is a quiet no-op, same as rm({ force: true }).
export async function removeWithinDirectory(roots: string | string[], target: string | null | undefined) {
  if (!target) return false;
  for (const root of [roots].flat()) {
    let resolved: string;
    try {
      resolved = await assertWithinDirectory(root, target);
    } catch (error) {
      if (error instanceof AppError && error.code === "UNSAFE_PATH") continue;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    await rm(resolved, { force: true });
    return true;
  }
  const stillThere = await access(target).then(() => true, () => false);
  if (stillThere) {
    await writeLog({ level: "warn", category: "maintenance", message: `Skipped deleting ${target}: it is outside the directory TunarrTube wrote it to.` }).catch(() => undefined);
  }
  return false;
}

// The cookies file and request delay yt-dlp should use for one site: that site's SiteSetting row
// where set, else the global AppSettings.ytdlpCookiesPath and the site's built-in default delay.
export async function siteRequestSettings(site: SiteId) {
  const [settings, row] = await Promise.all([getSettings(), db.siteSetting.findUnique({ where: { site } })]);
  return {
    cookiesPath: row?.cookiesPath ?? settings.ytdlpCookiesPath ?? null,
    sleepRequestsSeconds: row?.sleepRequestsSeconds ?? SITES[site].defaultSleepRequestsSeconds
  };
}

// Every site's requirements (from lib/youtube/sites.ts) alongside its own settings and what's in
// effect after fallbacks, for Settings → Sites. Lists cookies file *paths* only, never contents.
export async function getSiteSettingsView() {
  const [settings, rows] = await Promise.all([getSettings(), db.siteSetting.findMany()]);
  const bySite = new Map(rows.map((row) => [row.site, row]));
  return Object.values(SITES).map((site) => {
    const row = bySite.get(site.id);
    const cookiesPath = row?.cookiesPath ?? null;
    const sleepRequestsSeconds = row?.sleepRequestsSeconds ?? null;
    return {
      site: site.id,
      label: site.label,
      signIn: site.signIn,
      note: site.note,
      supportsStreaming: site.supportsStreaming,
      hasChannels: site.channelFeeds.length > 0,
      defaultSleepRequestsSeconds: site.defaultSleepRequestsSeconds,
      cookiesPath,
      sleepRequestsSeconds,
      effectiveCookiesPath: cookiesPath ?? settings.ytdlpCookiesPath ?? null,
      cookiesSource: cookiesPath ? "site" as const : settings.ytdlpCookiesPath ? "global" as const : null,
      effectiveSleepRequestsSeconds: sleepRequestsSeconds ?? site.defaultSleepRequestsSeconds
    };
  });
}

export async function updateSiteSetting(site: SiteId, input: { cookiesPath?: string | null; sleepRequestsSeconds?: number | null }) {
  const cookiesPath = input.cookiesPath === undefined || input.cookiesPath === null ? input.cookiesPath : await validateCookiesPath(input.cookiesPath);
  const data = { ...(cookiesPath !== undefined ? { cookiesPath } : {}), ...(input.sleepRequestsSeconds !== undefined ? { sleepRequestsSeconds: input.sleepRequestsSeconds } : {}) };
  await db.siteSetting.upsert({ where: { site }, update: data, create: { site, ...data } });
  await writeLog({ level: "info", category: "settings", message: `Updated ${SITES[site].label} site settings.` }).catch(() => undefined);
  return (await getSiteSettingsView()).find((view) => view.site === site)!;
}

export type SiteSettingView = Awaited<ReturnType<typeof getSiteSettingsView>>[number];
