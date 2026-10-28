import { AppError } from "@/lib/api";
import { SITES, siteForStoredUrl, storageId, type Site } from "@/lib/youtube/sites";
import type { PlaylistAnalysis, PlaylistEntry } from "@/lib/youtube/types";

type Raw = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

export function parseUploadDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) return null;
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Some CDNs (Bilibili's hdslb.com) report thumbnails as protocol-relative or plain-http URLs that
// they also serve over HTTPS; upgrade those so lib/thumbnails/service.ts's HTTPS-only fetch and
// next/image's remotePatterns accept them.
function httpsUrl(value: string | null) {
  if (!value) return null;
  if (value.startsWith("//")) return `https:${value}`;
  return value.replace(/^http:\/\//i, "https://");
}

function thumbnail(raw: Raw) {
  const direct = text(raw.thumbnail);
  if (direct) return httpsUrl(direct);
  if (!Array.isArray(raw.thumbnails)) return null;
  for (let index = raw.thumbnails.length - 1; index >= 0; index -= 1) {
    const candidate = raw.thumbnails[index] as Raw;
    const url = text(candidate?.url);
    if (url) return httpsUrl(url);
  }
  return null;
}

// Some extractors' flat-playlist stubs carry titles still HTML-escaped from the page (Vimeo:
// "What&#039;s new"). YouTube titles are left untouched, as before multi-site support.
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decodeEntities(value: string) {
  return value.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,6});/gi, (match, code: string) => {
    if (code[0] !== "#") return NAMED_ENTITIES[code.toLowerCase()] ?? match;
    const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
  });
}

export function normalizeEntry(raw: Raw, fallbackIndex?: number, site: Site = SITES.youtube): PlaylistEntry | null {
  const ref = site.resolveEntry(raw);
  if (!ref) return null;
  const youtubeId = storageId(site, ref.rawId);
  const youtubeUrl = ref.url;
  const rawAvailability = text(raw.availability)?.toLowerCase();
  const unavailable = rawAvailability && rawAvailability !== "public" && rawAvailability !== "unlisted";
  return {
    youtubeId,
    title: (site.id === "youtube" ? text(raw.title) : text(raw.title) && decodeEntities(text(raw.title)!)) ?? `${site.label} video ${ref.rawId}`,
    description: text(raw.description),
    durationSeconds: number(raw.duration),
    uploadDate: parseUploadDate(raw.upload_date),
    thumbnailUrl: thumbnail(raw),
    uploader: text(raw.uploader) ?? text(raw.channel),
    youtubeUrl,
    playlistIndex: number(raw.playlist_index) ?? fallbackIndex ?? null,
    availability: unavailable ? "unavailable" : rawAvailability ? "available" : "unknown",
    // yt-dlp's YouTube extractor only fills these from a video's "Music in this video" attachment data,
    // which is only present on a full per-video fetch (fetchVideoMetadata below), never under
    // --flat-playlist. "creator" is yt-dlp's fallback name for the same byline on some watch pages that
    // don't expose a dedicated "artist" field.
    artist: text(raw.artist) ?? text(raw.creator),
    album: text(raw.album)
  };
}

export function normalizePlaylist(raw: Raw, requestedUrl: string): PlaylistAnalysis {
  if (!Array.isArray(raw.entries)) throw new AppError("INVALID_PLAYLIST_DATA", "yt-dlp did not return a complete playlist.", 502);
  const site = siteForStoredUrl(requestedUrl);
  // A nested playlist that reached here unexpanded (see expandNestedPlaylists) would otherwise be
  // filtered out below as "not a video" and the source would look complete without its videos.
  if (site.nestedPlaylist && raw.entries.some((entry) => entry && typeof entry === "object" && site.nestedPlaylist!(entry as Raw))) {
    throw new AppError("NESTED_PLAYLIST_UNEXPANDED", `yt-dlp returned a nested ${site.label} collection that wasn't expanded, so the video list would be incomplete.`, 502);
  }
  const entries = raw.entries
    .map((entry, index) => normalizeEntry((entry ?? {}) as Raw, index + 1, site))
    .filter((entry): entry is PlaylistEntry => Boolean(entry));
  const reportedCount = number(raw.playlist_count);
  if (entries.length === 0) {
    const version = raw._version && typeof raw._version === "object"
      ? text((raw._version as Raw).version)
      : null;
    if (reportedCount && reportedCount > 0) {
      throw new AppError(
        "YTDLP_PLAYLIST_INCOMPLETE",
        `yt-dlp${version ? ` ${version}` : ""} detected ${reportedCount} playlist items but could not extract them. Update yt-dlp, then sync or analyze again.`,
        502,
        { reportedCount, extractedCount: 0, version }
      );
    }
    throw new AppError("EMPTY_PLAYLIST", "The playlist contains no extractable videos. It may be empty, private, or require a newer yt-dlp version.", 422);
  }
  const rawId = text(raw.id);
  if (!rawId) throw new AppError("INVALID_PLAYLIST_DATA", `The playlist has no stable ${site.label} ID.`, 502);
  return {
    youtubeId: storageId(site, rawId),
    name: text(raw.title) ?? `${site.label} playlist ${rawId}`,
    uploaderName: text(raw.uploader) ?? text(raw.channel),
    thumbnailUrl: thumbnail(raw) ?? entries.find((entry) => entry.thumbnailUrl)?.thumbnailUrl ?? null,
    url: text(raw.webpage_url) ?? requestedUrl,
    entries,
    sourceType: "playlist",
    feedType: "playlist",
    historyLimit: null
  };
}

// Bounds on expanding a channel's nested playlists, so one profile can't fan out into unbounded yt-dlp
// runs. Exceeding one is an error, never a silently truncated channel.
export const MAX_NESTED_PLAYLISTS = 25;

export type NestedPlaylistFetcher = (url: string, playlistEnd: number | null) => Promise<Raw>;

function incompleteChannel(site: Site, detail: string, details?: Record<string, unknown>) {
  return new AppError("YTDLP_PLAYLIST_INCOMPLETE", `yt-dlp returned ${detail} for this ${site.label} channel, so its video list would be incomplete. Update yt-dlp, then sync or analyze again.`, 502, details);
}

// Replaces each nested-playlist entry of a flat channel listing (Site.nestedPlaylist -- a Bilibili
// profile's hidden-mode collections) with that playlist's own video entries, in place, keeping channel
// order. Videos already listed (directly or by an earlier collection) are kept once, at their first
// position. With a history limit, collection fetches stop once that many unique videos are collected.
// Every entry must resolve to a video or an expandable playlist: anything else -- a malformed collection
// stub, a collection nested inside a collection, an entry the site can't map, a collection that returns
// fewer entries than it reports -- throws, because dropping it would sync an incomplete channel as if it
// were complete. Sites without nestedPlaylist pass through untouched.
export async function expandNestedPlaylists(raw: Raw, site: Site, historyLimit: number | null, fetchPlaylist: NestedPlaylistFetcher): Promise<Raw> {
  if (!site.nestedPlaylist || !Array.isArray(raw.entries)) return raw;
  const entries: Raw[] = [];
  const seen = new Set<string>();
  const full = () => historyLimit !== null && entries.length >= historyLimit;
  const add = (entry: Raw, index: number) => {
    const ref = site.resolveEntry(entry);
    if (!ref) throw incompleteChannel(site, `an entry it couldn't map to a video (item ${index + 1})`);
    if (seen.has(ref.rawId)) return;
    seen.add(ref.rawId);
    // A collection's own playlist_index would collide with the channel's; normalizePlaylist falls back
    // to the merged position instead.
    const merged = { ...entry };
    delete merged.playlist_index;
    entries.push(merged);
  };
  let expanded = 0;
  for (const [index, item] of raw.entries.entries()) {
    if (full()) break;
    const entry = (item && typeof item === "object" ? item : {}) as Raw;
    const nested = site.nestedPlaylist(entry);
    if (!nested) {
      add(entry, index);
      continue;
    }
    if (!nested.url) throw incompleteChannel(site, `a collection entry with an unrecognized link (item ${index + 1})`);
    if (++expanded > MAX_NESTED_PLAYLISTS) {
      throw new AppError("NESTED_PLAYLIST_LIMIT", `This ${site.label} channel contains more than ${MAX_NESTED_PLAYLISTS} hidden collections. Add the collections as separate playlist sources, or set a smaller history limit.`, 422, { limit: MAX_NESTED_PLAYLISTS });
    }
    const child = await fetchPlaylist(nested.url, historyLimit);
    if (!Array.isArray(child.entries)) throw incompleteChannel(site, `no video list for the collection ${nested.url}`);
    const reported = number(child.playlist_count);
    const expected = reported === null ? 0 : Math.min(reported, historyLimit ?? reported);
    if (child.entries.length < expected) {
      throw incompleteChannel(site, `${child.entries.length} of ${reported} videos for the collection ${nested.url}`, { reportedCount: reported, extractedCount: child.entries.length });
    }
    for (const childItem of child.entries) {
      if (full()) break;
      const childEntry = (childItem && typeof childItem === "object" ? childItem : {}) as Raw;
      if (site.nestedPlaylist(childEntry)) throw incompleteChannel(site, `a collection nested inside the collection ${nested.url}`);
      add(childEntry, index);
    }
  }
  return { ...raw, entries };
}

export function normalizeChannel(raw: Raw, requestedUrl: string, feedType: "videos" | "shorts" | "live", historyLimit: number | null): PlaylistAnalysis {
  const normalized = normalizePlaylist(raw, requestedUrl);
  const site = siteForStoredUrl(requestedUrl);
  const rawChannelId = text(raw.channel_id) ?? text(raw.uploader_id);
  const stableId = rawChannelId ? storageId(site, rawChannelId) : normalized.youtubeId;
  return {
    ...normalized,
    youtubeId: stableId,
    sourceType: "channel",
    feedType,
    historyLimit,
    url: requestedUrl
  };
}
