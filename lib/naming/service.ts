// Resolves a downloaded video's on-disk filename/folder layout from a Source's (or the global
// default's) naming scheme. Everything below assignEpisodeNumber is framework-agnostic (no fs/Prisma
// imports) so it's cheap to unit test and so lib/downloads/service.ts is the only place that turns these
// into real fs calls -- see resolveVideoPaths, which replaces three previously-duplicated
// `${youtubeId}.mp4` computations (downloadVideo/retagVideo/materializeForTunarr).
//
// Three schemes:
//  - "id"       today's default and back-compat behavior: "<mediaDirectory>/<youtubeId>.mp4", flat.
//  - "template" a user-authored filename template ({title}/{channel}/{date}/{year}/{videoId} tokens).
//               A literal "/" in the template (not inside a substituted value -- see
//               sanitizeFilenameComponent) creates real subfolders, e.g. "{channel}/{title}" -- this is
//               how the "configurable folder structure" half of the feature request is served without a
//               second template field. The raw videoId is always appended as a " [videoId]" suffix when
//               the filled result doesn't already contain it, so lib/tunarr/service.ts:mapPrograms can
//               always recover it and so two same-titled videos never collide on disk.
//  - "tvshow"   Emby/Plex/Jellyfin- and Tunarr "Shows"-scanner-compatible layout: "Season <year>/<Source
//               name> - S<year>E<episode> - <title> [<videoId>].mp4". Requires season/episode to already
//               be assigned (see assignEpisodeNumber) -- this module never computes them itself since
//               that requires a DB read/write with concurrency handling, which belongs in
//               lib/downloads/service.ts alongside the other membership updates.

import { db } from "@/lib/db/client";

export const NAMING_SCHEMES = ["id", "template", "tvshow"] as const;
export type NamingScheme = (typeof NAMING_SCHEMES)[number];

export interface NamingVars {
  title: string;
  channel: string;
  date: string;
  year: string;
  videoId: string;
}

export interface ResolveVideoPathsInput {
  mediaDirectory: string;
  scheme: NamingScheme;
  template: string;
  source: { name: string };
  video: { youtubeId: string; title: string; uploadDate: Date | null };
  season?: number | null;
  episode?: number | null;
}

export interface ResolvedVideoPaths {
  // Absolute directory the video file (and its same-basename sidecars) live in -- may be nested under
  // mediaDirectory (a user template segment, or "Season <year>" in tvshow mode).
  directory: string;
  // Filename without extension, shared by the video, its NFO, its poster/thumb, and its JSON sidecar.
  basename: string;
  // "-poster" for id/template (Tunarr other_videos + Kodi convention, unchanged from today) or "-thumb"
  // for tvshow (Emby/Kodi reserve "-poster" for show/season-level art, "-thumb" for episode-level art).
  posterSuffix: "-poster" | "-thumb";
  // Sidecar JSON extension: ".json" for id/template (unchanged), ".info.json" for tvshow (matches the
  // richer payload written in that mode -- see lib/downloads/service.ts).
  sidecarExtension: ".json" | ".info.json";
  // Present only for "tvshow" -- the once-per-Source "<mediaDirectory>/tvshow.nfo" show-level NFO path.
  showNfoPath: string | null;
}

const ILLEGAL_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;
// Windows reserved device names -- even though this app targets Linux/Docker deployments primarily, a
// user-authored template shouldn't be able to produce a filename that's unusable if storage is ever a
// Windows-hosted bind mount.
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\..*)?$/i;

export function sanitizeFilenameComponent(value: string, fallback: string): string {
  const cleaned = value
    .replace(ILLEGAL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Trailing dots/spaces are silently stripped by Windows, which can make two different intended
    // filenames collide on disk without any error.
    .replace(/[. ]+$/, "")
    // Leave headroom under typical 255-byte filename limits once combined with other template segments,
    // the " [videoId]" suffix, and an extension.
    .slice(0, 150)
    .trim();
  if (!cleaned || RESERVED_NAMES.test(cleaned)) return fallback;
  return cleaned;
}

const TOKEN = /\{\s*([a-zA-Z0-9_]+)\s*\}/g;

// Fills {title}/{channel}/{date}/{year}/{videoId} tokens, sanitizing each substituted value so it can
// never inject a path separator or illegal character -- but literal characters the user typed in the
// template itself (including "/") pass through untouched, so "{channel}/{title}" intentionally produces
// a subfolder. Unknown tokens resolve to "".
export function fillNamingTemplate(template: string, vars: NamingVars): string {
  return template.replace(TOKEN, (_match, key: string) => {
    const raw = (vars as unknown as Record<string, string>)[key];
    if (raw === undefined) return "";
    return sanitizeFilenameComponent(raw, "");
  });
}

export function namingVarsFor(source: { name: string }, video: { youtubeId: string; title: string; uploadDate: Date | null }): NamingVars {
  const date = video.uploadDate;
  return {
    title: video.title,
    channel: source.name,
    date: date ? date.toISOString().slice(0, 10) : "",
    year: date ? String(date.getUTCFullYear()) : "",
    videoId: video.youtubeId
  };
}

function splitIntoSegments(filled: string): string[] {
  return filled
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

const VIDEO_ID_BRACKET = /\[([a-zA-Z0-9_-]{11})\]/;

function withVideoIdSuffix(basename: string, videoId: string): string {
  if (basename === videoId || VIDEO_ID_BRACKET.test(basename)) return basename;
  return `${basename} [${videoId}]`;
}

// The inverse of the suffixing above: recovers the raw YouTube ID from a filename basename regardless of
// which naming scheme produced it. "template"/"tvshow" basenames end with " [videoId]", so a bracket
// match wins when present; otherwise the whole basename is treated as the id, unchanged from the
// original (pre-naming-scheme) behavior where the filename basename WAS always the id. Used by
// lib/tunarr/service.ts:indexProgramsByYoutubeId to reconcile Tunarr's scanned programs (keyed by the
// filename it read off disk) back to a SourceVideo regardless of naming scheme.
export function extractVideoId(basename: string): string | null {
  const match = basename.match(VIDEO_ID_BRACKET);
  if (match) return match[1];
  return basename || null;
}

export function resolveVideoPaths(input: ResolveVideoPathsInput): ResolvedVideoPaths {
  const { mediaDirectory, scheme, video } = input;

  if (scheme === "id") {
    return {
      directory: mediaDirectory,
      basename: video.youtubeId,
      posterSuffix: "-poster",
      sidecarExtension: ".json",
      showNfoPath: null
    };
  }

  if (scheme === "template") {
    const vars = namingVarsFor(input.source, video);
    const filled = fillNamingTemplate(input.template, vars);
    const segments = splitIntoSegments(filled);
    const rawBasename = segments.length > 0 ? segments[segments.length - 1] : video.youtubeId;
    const directorySegments = segments.slice(0, -1);
    const basename = withVideoIdSuffix(rawBasename || video.youtubeId, video.youtubeId);
    return {
      directory: directorySegments.length > 0 ? [mediaDirectory, ...directorySegments].join("/") : mediaDirectory,
      basename,
      posterSuffix: "-poster",
      sidecarExtension: ".json",
      showNfoPath: null
    };
  }

  // "tvshow"
  const year = video.uploadDate ? video.uploadDate.getUTCFullYear() : new Date().getUTCFullYear();
  const season = input.season ?? year;
  const episode = input.episode ?? 1;
  const showName = sanitizeFilenameComponent(input.source.name, "Show");
  const title = sanitizeFilenameComponent(video.title, video.youtubeId);
  const episodeLabel = `S${season}E${String(episode).padStart(3, "0")}`;
  const basename = withVideoIdSuffix(`${showName} - ${episodeLabel} - ${title}`, video.youtubeId);
  return {
    directory: `${mediaDirectory}/Season ${season}`,
    basename,
    posterSuffix: "-thumb",
    sidecarExtension: ".info.json",
    showNfoPath: `${mediaDirectory}/tvshow.nfo`
  };
}

export function seasonNumberFor(video: { uploadDate: Date | null }): number {
  return video.uploadDate ? video.uploadDate.getUTCFullYear() : new Date().getUTCFullYear();
}

// Assigns a video's tvshow-mode season/episode once and persists it, so it's never recomputed (and
// nothing already on disk is ever renumbered) -- see the schema comment on SourceVideo.episodeNumber.
// Episode is "first assigned wins": 1 + the highest episodeNumber already recorded for this
// (sourceId, seasonNumber) pair, same shape as Pinchflat's own numbering. This runs inside the single
// in-process job worker (see AGENTS.md's single-instance assumption), so a plain read-then-write is safe
// without an explicit transaction -- no concurrent caller can interleave between the two.
export async function assignEpisodeNumber(sourceId: string, seasonNumber: number, membershipId: string): Promise<number> {
  const highest = await db.sourceVideo.findFirst({
    where: { sourceId, seasonNumber },
    orderBy: { episodeNumber: "desc" },
    select: { episodeNumber: true }
  });
  const episodeNumber = (highest?.episodeNumber ?? 0) + 1;
  await db.sourceVideo.update({ where: { id: membershipId }, data: { seasonNumber, episodeNumber } });
  return episodeNumber;
}

const POSTER_IMAGE_EXTENSIONS = ["jpg", "png", "webp"];

// Every sidecar path a video's own file might have alongside it, across every naming scheme this module
// can produce -- movie NFO + plain JSON + Kodi "-poster" art (id/template) and episode NFO + ".info.json"
// + "-thumb" art (tvshow). Used by lib/sources/service.ts:removeVideoFromSource and
// lib/tunarr/service.ts:unlinkTunarr so cleanup doesn't need to know which scheme originally wrote a
// given video's sidecars, only its localPath -- deliberately over-inclusive (rm is called with
// force: true, so a path that was never written is simply a no-op). Doesn't include the per-Source
// "tvshow.nfo" -- that's not per-video, so it's only removed when the whole Source is deleted.
export function sidecarPathsFor(localPath: string): string[] {
  const paths = [localPath.replace(/\.mp4$/i, ".json"), localPath.replace(/\.mp4$/i, ".nfo"), localPath.replace(/\.mp4$/i, ".info.json")];
  for (const extension of POSTER_IMAGE_EXTENSIONS) {
    paths.push(localPath.replace(/\.mp4$/i, `-poster.${extension}`), localPath.replace(/\.mp4$/i, `-thumb.${extension}`));
  }
  return paths;
}
