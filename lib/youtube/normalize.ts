import { AppError } from "@/lib/api";
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

function thumbnail(raw: Raw) {
  const direct = text(raw.thumbnail);
  if (direct) return direct;
  if (!Array.isArray(raw.thumbnails)) return null;
  for (let index = raw.thumbnails.length - 1; index >= 0; index -= 1) {
    const candidate = raw.thumbnails[index] as Raw;
    const url = text(candidate?.url);
    if (url) return url;
  }
  return null;
}

export function normalizeEntry(raw: Raw, fallbackIndex?: number): PlaylistEntry | null {
  const youtubeId = text(raw.id);
  if (!youtubeId) return null;
  const rawAvailability = text(raw.availability)?.toLowerCase();
  const unavailable = rawAvailability && rawAvailability !== "public" && rawAvailability !== "unlisted";
  return {
    youtubeId,
    title: text(raw.title) ?? `YouTube video ${youtubeId}`,
    description: text(raw.description),
    durationSeconds: number(raw.duration),
    uploadDate: parseUploadDate(raw.upload_date),
    thumbnailUrl: thumbnail(raw),
    uploader: text(raw.uploader) ?? text(raw.channel),
    youtubeUrl: text(raw.webpage_url) ?? `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`,
    playlistIndex: number(raw.playlist_index) ?? fallbackIndex ?? null,
    availability: unavailable ? "unavailable" : rawAvailability ? "available" : "unknown"
  };
}

export function normalizePlaylist(raw: Raw, requestedUrl: string): PlaylistAnalysis {
  if (!Array.isArray(raw.entries)) throw new AppError("INVALID_PLAYLIST_DATA", "yt-dlp did not return a complete playlist.", 502);
  const entries = raw.entries
    .map((entry, index) => normalizeEntry((entry ?? {}) as Raw, index + 1))
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
  const youtubeId = text(raw.id);
  if (!youtubeId) throw new AppError("INVALID_PLAYLIST_DATA", "The playlist has no stable YouTube ID.", 502);
  return {
    youtubeId,
    name: text(raw.title) ?? `YouTube playlist ${youtubeId}`,
    uploaderName: text(raw.uploader) ?? text(raw.channel),
    thumbnailUrl: thumbnail(raw) ?? entries.find((entry) => entry.thumbnailUrl)?.thumbnailUrl ?? null,
    url: text(raw.webpage_url) ?? requestedUrl,
    entries,
    sourceType: "playlist",
    feedType: "playlist",
    historyLimit: null
  };
}

export function normalizeChannel(raw: Raw, requestedUrl: string, feedType: "videos" | "shorts" | "live", historyLimit: number | null): PlaylistAnalysis {
  const normalized = normalizePlaylist(raw, requestedUrl);
  const stableId = text(raw.channel_id) ?? text(raw.uploader_id) ?? normalized.youtubeId;
  return {
    ...normalized,
    youtubeId: stableId,
    sourceType: "channel",
    feedType,
    historyLimit,
    url: requestedUrl
  };
}
