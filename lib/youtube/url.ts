import { AppError } from "@/lib/api";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const HOSTS = new Set([...YOUTUBE_HOSTS, "youtu.be"]);

export type YouTubeSourceUrl = { url: string; sourceType: "playlist" | "channel" | "video" };

export function validatePlaylistUrl(input: string) {
  const parsed = validateSourceUrl(input);
  if (parsed.sourceType !== "playlist") throw new AppError("PLAYLIST_REQUIRED", "Enter a YouTube playlist URL.");
  return parsed.url;
}

export function validateSourceUrl(input: string): YouTubeSourceUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError("INVALID_YOUTUBE_URL", "Enter a valid YouTube video, playlist, or channel URL.");
  }
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname.toLowerCase())) {
    throw new AppError("INVALID_YOUTUBE_URL", "Only HTTPS URLs on supported YouTube domains are accepted.");
  }
  if (url.searchParams.get("list")) return { url: url.toString(), sourceType: "playlist" };
  const parts = url.pathname.split("/").filter(Boolean);
  const first = parts[0] ?? "";
  const videoId = url.hostname.toLowerCase() === "youtu.be"
    ? first
    : first === "watch"
      ? url.searchParams.get("v")
      : ["shorts", "live", "embed"].includes(first) ? parts[1] : null;
  if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return { url: `https://www.youtube.com/watch?v=${videoId}`, sourceType: "video" };
  }
  const channelPath = first.startsWith("@") || ["channel", "user", "c"].includes(first);
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase()) || !channelPath) {
    throw new AppError("YOUTUBE_SOURCE_REQUIRED", "Enter a YouTube video, playlist, or channel URL.");
  }
  url.search = "";
  url.hash = "";
  return { url: url.toString().replace(/\/$/, ""), sourceType: "channel" };
}

export function validateVideoUrl(input: string) {
  const parsed = validateSourceUrl(input);
  if (parsed.sourceType !== "video") throw new AppError("VIDEO_REQUIRED", "Enter an individual YouTube video URL.");
  return parsed.url;
}
