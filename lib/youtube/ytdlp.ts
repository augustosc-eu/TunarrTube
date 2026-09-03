import { AppError } from "@/lib/api";
import { discoverBinary } from "@/lib/system/binaries";
import { runProcess } from "@/lib/system/process";
import { normalizeChannel, normalizeEntry, normalizePlaylist } from "@/lib/youtube/normalize";
import type { AnalyzeSourceOptions, ChannelFeed, PlaylistAnalysis, PlaylistEntry } from "@/lib/youtube/types";
import { validatePlaylistUrl, validateSourceUrl, validateVideoUrl } from "@/lib/youtube/url";

async function executable() {
  const binary = await discoverBinary("yt-dlp");
  if (!binary) throw new AppError("YTDLP_NOT_FOUND", "yt-dlp was not found. Install it or set YTARR_YTDLP_PATH.", 503);
  return binary;
}

export async function analyzePlaylist(input: string, signal?: AbortSignal): Promise<PlaylistAnalysis> {
  const url = validatePlaylistUrl(input);
  const result = await runProcess(await executable(), ["--dump-single-json", "--flat-playlist", "--no-warnings", "--", url], {
    signal,
    timeoutMs: 10 * 60_000
  });
  try {
    return normalizePlaylist(JSON.parse(result.stdout) as Record<string, unknown>, url);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID_YTDLP_JSON", "yt-dlp returned malformed playlist data.", 502);
  }
}

function channelFeedUrl(base: string, feed: Exclude<ChannelFeed, "all">) {
  return `${base.replace(/\/$/, "")}/${feed === "live" ? "streams" : feed}`;
}

async function analyzeChannelFeed(base: string, feed: Exclude<ChannelFeed, "all">, historyLimit: number | null, signal?: AbortSignal) {
  const url = channelFeedUrl(base, feed);
  const args = ["--dump-single-json", "--flat-playlist", "--no-warnings"];
  if (historyLimit !== null) args.push("--playlist-end", String(historyLimit));
  args.push("--", url);
  const result = await runProcess(await executable(), args, { signal, timeoutMs: 10 * 60_000 });
  try {
    return normalizeChannel(JSON.parse(result.stdout) as Record<string, unknown>, base, feed, historyLimit);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID_YTDLP_JSON", "yt-dlp returned malformed channel data.", 502);
  }
}

export async function analyzeSource(input: string, options: AnalyzeSourceOptions = {}, signal?: AbortSignal): Promise<PlaylistAnalysis> {
  const parsed = validateSourceUrl(input);
  if (parsed.sourceType === "playlist") return analyzePlaylist(parsed.url, signal);
  if (parsed.sourceType === "video") {
    const entry = await fetchVideoMetadata(parsed.url, signal);
    return {
      youtubeId: entry.youtubeId,
      name: `${entry.uploader ?? "YouTube"} collection`,
      uploaderName: entry.uploader,
      thumbnailUrl: entry.thumbnailUrl,
      url: parsed.url,
      entries: [{ ...entry, playlistIndex: 1 }],
      sourceType: "collection",
      feedType: "manual",
      historyLimit: null
    };
  }
  const feed = options.feedType ?? "videos";
  const historyLimit = options.historyLimit === undefined ? 100 : options.historyLimit;
  if (feed !== "all") return analyzeChannelFeed(parsed.url, feed, historyLimit, signal);
  const results = await Promise.allSettled((["videos", "shorts", "live"] as const).map((item) => analyzeChannelFeed(parsed.url, item, historyLimit, signal)));
  const analyses = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (!analyses.length) throw results[0].status === "rejected" ? results[0].reason : new AppError("EMPTY_CHANNEL", "The channel has no extractable videos.", 422);
  const byId = new Map<string, PlaylistEntry>();
  for (const analysis of analyses) for (const entry of analysis.entries) if (!byId.has(entry.youtubeId)) byId.set(entry.youtubeId, entry);
  const entries = [...byId.values()]
    .sort((left, right) => (right.uploadDate?.getTime() ?? 0) - (left.uploadDate?.getTime() ?? 0) || (left.playlistIndex ?? 0) - (right.playlistIndex ?? 0))
    .slice(0, historyLimit ?? undefined)
    .map((entry, index) => ({ ...entry, playlistIndex: index + 1 }));
  return { ...analyses[0], name: analyses[0].name.replace(/ - (Videos|Shorts|Live)$/, ""), feedType: "all", historyLimit, entries };
}

export async function fetchVideoMetadata(youtubeUrl: string, signal?: AbortSignal): Promise<PlaylistEntry> {
  const url = validateVideoUrl(youtubeUrl);
  const result = await runProcess(await executable(), ["--dump-single-json", "--skip-download", "--no-warnings", "--", url], {
    signal,
    timeoutMs: 5 * 60_000
  });
  try {
    const raw = JSON.parse(result.stdout) as Record<string, unknown>;
    const entry = normalizeEntry(raw);
    if (!entry) throw new Error("missing video id");
    return entry;
  } catch {
    throw new AppError("INVALID_YTDLP_JSON", "yt-dlp returned malformed video metadata.", 502);
  }
}

export async function getYtDlpPath() {
  return executable();
}

export async function resolveStreamUrl(youtubeUrl: string, signal?: AbortSignal) {
  const result = await runProcess(await executable(), [
    "--get-url", "--no-playlist", "--no-warnings",
    "-f", "b[ext=mp4][vcodec^=avc][acodec^=mp4a]/b[ext=mp4]/best",
    "--", youtubeUrl
  ], { signal, timeoutMs: 2 * 60_000 });
  const value = result.stdout.trim().split(/\r?\n/)[0];
  if (!value) throw new AppError("STREAM_URL_MISSING", "YouTube did not return a playable stream URL.", 502);
  const url = new URL(value);
  if (url.protocol !== "https:" || !(url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com") || url.hostname.endsWith(".googlevideo.com"))) {
    throw new AppError("STREAM_URL_REJECTED", "YouTube returned an unexpected stream host.", 502);
  }
  return url.toString();
}
