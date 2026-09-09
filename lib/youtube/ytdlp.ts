import { AppError } from "@/lib/api";
import { getSettings } from "@/lib/settings/service";
import { discoverBinary } from "@/lib/system/binaries";
import { runProcess } from "@/lib/system/process";
import { normalizeChannel, normalizeEntry, normalizePlaylist } from "@/lib/youtube/normalize";
import type { AnalyzeSourceOptions, ChannelFeed, PlaylistAnalysis, PlaylistEntry } from "@/lib/youtube/types";
import { validatePlaylistUrl, validateSourceUrl, validateVideoUrl } from "@/lib/youtube/url";
import { streamFormatSelector, type VideoQuality } from "@/lib/youtube/quality";

async function executable() {
  const binary = await discoverBinary("yt-dlp");
  if (!binary) throw new AppError("YTDLP_NOT_FOUND", "yt-dlp was not found. Install it or set TUNARRTUBE_YTDLP_PATH.", 503);
  return binary;
}

// Appended to every yt-dlp invocation below (and to downloadMp4 in lib/downloads/service.ts) when the
// operator has pointed AppSettings.ytdlpCookiesPath at a Netscape-format cookies.txt file. Lets
// age-restricted/bot-checked videos ("Sign in to confirm your age/you're not a bot", see
// isSignInRequiredError below) authenticate instead of permanently failing. Unset by default -- file-path-
// only and opt-in, never accepting credentials through the app itself. safeCommand()/sanitizeLogValue
// (lib/logging/service.ts, lib/system/process.ts) already redact the path out of any logged command line
// or yt-dlp error text the same way they redact `--cookies-from-browser`.
export async function cookiesArgs() {
  const settings = await getSettings();
  return settings.ytdlpCookiesPath ? ["--cookies", settings.ytdlpCookiesPath] : [];
}

export async function analyzePlaylist(input: string, signal?: AbortSignal): Promise<PlaylistAnalysis> {
  const url = validatePlaylistUrl(input);
  const result = await runProcess(await executable(), ["--dump-single-json", "--flat-playlist", "--no-warnings", ...await cookiesArgs(), "--", url], {
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
  args.push(...await cookiesArgs(), "--", url);
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
  const result = await runProcess(await executable(), ["--dump-single-json", "--skip-download", "--no-warnings", ...await cookiesArgs(), "--", url], {
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

type PlayabilityStatus = {
  reason?: string;
  errorScreen?: {
    playerInterstitialRenderer?: { content?: { interstitialViewModel?: { description?: { content?: string } } } };
    playerErrorMessageRenderer?: { subreason?: { runs?: Array<{ text?: string }> } };
  };
};

export function extractAvailabilityReason(html: string) {
  const marker = '"playabilityStatus":';
  let offset = 0;
  while ((offset = html.indexOf(marker, offset)) >= 0) {
    const start = html.indexOf("{", offset + marker.length);
    if (start < 0) return null;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < html.length; index += 1) {
      const character = html[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        try {
          const status = JSON.parse(html.slice(start, index + 1)) as PlayabilityStatus;
          const interstitial = status.errorScreen?.playerInterstitialRenderer?.content?.interstitialViewModel?.description?.content;
          const legacy = status.errorScreen?.playerErrorMessageRenderer?.subreason?.runs?.map((run) => run.text).filter(Boolean).join(" ");
          const reason = interstitial ?? legacy ?? status.reason;
          if (reason?.trim()) return reason.replace(/\s+/g, " ").trim().slice(0, 1000);
        } catch { /* Try another embedded player response. */ }
        offset = index + 1;
        break;
      }
    }
    if (offset <= start) return null;
  }
  return null;
}

export async function fetchVideoAvailabilityReason(youtubeUrl: string, signal?: AbortSignal) {
  const url = validateVideoUrl(youtubeUrl);
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetch(`${url}&hl=en`, {
    headers: { "Accept-Language": "en-US,en;q=0.9", "User-Agent": "Mozilla/5.0 (compatible; TunarrTube/0.1)" },
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  });
  if (!response.ok) return null;
  return extractAvailabilityReason(await response.text());
}

export async function getYtDlpPath() {
  return executable();
}

// yt-dlp surfaces YouTube's throttling as an HTTP 429 in the extractor error it prints to stderr, which
// `runProcess` folds into the failure message. Distinct from "Sign in to confirm you're not a bot" (see
// isSignInRequiredError below), a bot-check that needs cookies/auth to resolve rather than a pause --
// this is purely "you're requesting too fast," which calling code should treat as a signal to back off.
const RATE_LIMIT_SIGNAL = /HTTP Error 429|429 Client Error|Too Many Requests/i;

export function isRateLimitedError(message: string) {
  return RATE_LIMIT_SIGNAL.test(message);
}

// yt-dlp's message for a video that's gone for good -- deleted, made private, taken down, region/
// copyright blocked -- as opposed to a transient failure. Retrying this exact video will never succeed,
// so callers (enrichVideo in lib/metadata/service.ts, downloadVideo/cacheVideo in
// lib/downloads/service.ts) should record it and stop rather than burn retries on it.
const UNAVAILABLE_SIGNAL = /private|unavailable|deleted|removed/i;

export function isUnavailableVideoError(message: string) {
  return UNAVAILABLE_SIGNAL.test(message);
}

// yt-dlp's message when YouTube demands authentication before it'll serve the video at all: age-gated
// content ("Sign in to confirm your age") or a bot-check challenge ("Sign in to confirm you're not a
// bot"). Unlike UNAVAILABLE_SIGNAL above, the video isn't gone -- it's fixable by configuring
// AppSettings.ytdlpCookiesPath (see cookiesArgs above) -- but retrying *without* cookies configured will
// never succeed, so callers should still stop burning automatic retries on it, same as an unavailable
// video, just with a more actionable reason (see unavailabilityReason below).
const SIGN_IN_REQUIRED_SIGNAL = /sign in to confirm/i;

export function isSignInRequiredError(message: string) {
  return SIGN_IN_REQUIRED_SIGNAL.test(message);
}

// Pulls yt-dlp's own one-line reason out of its stderr ("ERROR: [youtube] <id>: <reason>") for use when a
// richer reason isn't available from fetchVideoAvailabilityReason() above (e.g. it also failed, or the
// caller doesn't want to spend an extra network round-trip on top of the yt-dlp failure it already got).
export function readableUnavailabilityReason(message: string) {
  const detail = message.match(/ERROR:\s*\[youtube\]\s+[^:]+:\s*(.+)/i)?.[1]?.trim();
  return detail && detail.length <= 500 ? detail : "YouTube did not provide a more specific reason.";
}

// Shared by enrichVideo (lib/metadata/service.ts) and downloadVideo/cacheVideo (lib/downloads/service.ts)
// to build the Video.availabilityReason they show in the UI once a video fails with isUnavailableVideoError
// or isSignInRequiredError. Sign-in-required gets its own message rather than yt-dlp's raw one -- yt-dlp's
// text points at --cookies-from-browser, which doesn't apply in a headless container -- pointed at the
// Settings field instead.
export async function unavailabilityReason(youtubeUrl: string, message: string) {
  if (isSignInRequiredError(message)) {
    return "Requires YouTube sign-in (age-restricted, or blocked by a bot check). Set a yt-dlp cookies file in Settings → External tools to enable this video.";
  }
  return await fetchVideoAvailabilityReason(youtubeUrl).catch(() => null) ?? readableUnavailabilityReason(message);
}

export async function resolveStreamUrl(youtubeUrl: string, quality: VideoQuality = "best", signal?: AbortSignal) {
  const result = await runProcess(await executable(), [
    "--get-url", "--no-playlist", "--no-warnings",
    "-f", streamFormatSelector(quality),
    ...await cookiesArgs(),
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
