export const VIDEO_QUALITIES = ["best", "2160p", "1440p", "1080p", "720p", "480p"] as const;
export type VideoQuality = (typeof VIDEO_QUALITIES)[number];

const HEIGHTS: Record<Exclude<VideoQuality, "best">, number> = {
  "2160p": 2160,
  "1440p": 1440,
  "1080p": 1080,
  "720p": 720,
  "480p": 480
};

export function isVideoQuality(value: string | null | undefined): value is VideoQuality {
  return !!value && (VIDEO_QUALITIES as readonly string[]).includes(value);
}

/** A per-source override wins when set; otherwise fall back to the global default. */
export function resolveEffectiveQuality(sourceOverride: string | null | undefined, globalDefault: string): VideoQuality {
  if (isVideoQuality(sourceOverride)) return sourceOverride;
  return isVideoQuality(globalDefault) ? globalDefault : "best";
}

/** Format selector for permanent/cache downloads (lib/downloads/service.ts). */
export function downloadFormatSelector(quality: VideoQuality): string {
  if (quality === "best") return "bv*[vcodec^=avc]+ba[acodec^=mp4a]/b[ext=mp4]/best";
  const h = HEIGHTS[quality];
  return `bv*[vcodec^=avc][height<=${h}]+ba[acodec^=mp4a]/b[ext=mp4][height<=${h}]/bv*[height<=${h}]+ba/b[height<=${h}]/best[height<=${h}]/best`;
}

/** Format selector for stream-mode playback URL resolution (lib/youtube/ytdlp.ts). */
export function streamFormatSelector(quality: VideoQuality): string {
  if (quality === "best") return "b[ext=mp4][vcodec^=avc][acodec^=mp4a]/b[ext=mp4]/best";
  const h = HEIGHTS[quality];
  return `b[ext=mp4][vcodec^=avc][acodec^=mp4a][height<=${h}]/b[ext=mp4][height<=${h}]/b[height<=${h}]/best[height<=${h}]/best`;
}
