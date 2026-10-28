import { AppError } from "@/lib/api";
import { siteForUrl, SUPPORTED_SITE_LABELS, type SourceUrl } from "@/lib/youtube/sites";

// Error codes keep their historical INVALID_YOUTUBE_URL/YOUTUBE_SOURCE_REQUIRED names (an API
// contract) even though the allow-list now spans every site in lib/youtube/sites.ts.
export type { SourceUrl } from "@/lib/youtube/sites";
/** @deprecated use SourceUrl */
export type YouTubeSourceUrl = SourceUrl;

export function validatePlaylistUrl(input: string) {
  const parsed = validateSourceUrl(input);
  if (parsed.sourceType !== "playlist") throw new AppError("PLAYLIST_REQUIRED", `Enter a ${SUPPORTED_SITE_LABELS} playlist URL.`);
  return parsed.url;
}

export function validateSourceUrl(input: string): SourceUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError("INVALID_YOUTUBE_URL", `Enter a valid ${SUPPORTED_SITE_LABELS} video, playlist, or channel URL.`);
  }
  const site = siteForUrl(url);
  if (!site) {
    throw new AppError("INVALID_YOUTUBE_URL", `Only HTTPS URLs on supported ${SUPPORTED_SITE_LABELS} domains are accepted.`);
  }
  const parsed = site.parse(url);
  if (!parsed) throw new AppError("YOUTUBE_SOURCE_REQUIRED", `Enter a ${site.label} ${site.channelFeeds.length ? "video, playlist, or channel" : "video or playlist"} URL.`);
  return { ...parsed, site: site.id };
}

export function validateVideoUrl(input: string) {
  const parsed = validateSourceUrl(input);
  if (parsed.sourceType !== "video") throw new AppError("VIDEO_REQUIRED", `Enter an individual ${SUPPORTED_SITE_LABELS} video URL.`);
  return parsed.url;
}
