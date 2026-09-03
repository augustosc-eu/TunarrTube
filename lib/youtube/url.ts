import { AppError } from "@/lib/api";

const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

export type YouTubeSourceUrl = { url: string; sourceType: "playlist" | "channel" };

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
    throw new AppError("INVALID_YOUTUBE_URL", "Enter a valid YouTube playlist URL.");
  }
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname.toLowerCase())) {
    throw new AppError("INVALID_YOUTUBE_URL", "Only HTTPS URLs on supported YouTube domains are accepted.");
  }
  if (url.searchParams.get("list")) return { url: url.toString(), sourceType: "playlist" };
  const parts = url.pathname.split("/").filter(Boolean);
  const first = parts[0] ?? "";
  const channelPath = first.startsWith("@") || ["channel", "user", "c"].includes(first);
  if (!channelPath) throw new AppError("YOUTUBE_SOURCE_REQUIRED", "Enter a YouTube playlist or channel URL.");
  url.search = "";
  url.hash = "";
  return { url: url.toString().replace(/\/$/, ""), sourceType: "channel" };
}
