import type { ChannelFeed } from "@/lib/youtube/types";

// The explicit allow-list of video sites TunarrTube accepts URLs from (see AGENTS.md rule 11). Every
// site here has a dedicated yt-dlp extractor, and every yt-dlp invocation for that site passes
// --use-extractors <extractors> so yt-dlp can never fall back to its "generic" extractor -- which
// would fetch an arbitrary URL from this server and turn URL analysis into an SSRF primitive against
// the operator's own network. Adding a site means adding an entry below (URL parsing, ID mapping,
// extractor names), its thumbnail CDN to next.config.ts's images.remotePatterns, and tests.
//
// Storage IDs: YouTube IDs are stored bare (unchanged, back-compat with every existing row/filename).
// Every other site's IDs are stored as "<site>.<rawId>" -- "." never appears in a YouTube ID, so the
// two can never collide even though Video.youtubeId is globally unique, and the site is recoverable
// from the ID alone (see siteForStoredId). The name `youtubeId` on Video/Source/ImportDraft is
// historical; it means "stable platform-scoped ID". Raw IDs of non-YouTube sites end up in filenames,
// so resolveEntry only ever returns filename-safe ones (SAFE_RAW_ID).
//
// This module is pure (no Node/server imports) so client components can use it for form hints.

export type SiteId = "youtube" | "bilibili" | "bilibilitv" | "archive" | "vimeo" | "dailymotion" | "twitch" | "niconico";
export type ParsedUrl = { url: string; sourceType: "playlist" | "channel" | "video" };
export type SourceUrl = ParsedUrl & { site: SiteId };
type Raw = Record<string, unknown>;
export type EntryRef = { rawId: string; url: string };
// A flat entry that stands for a whole nested playlist rather than one video. `url` is the canonical,
// re-validated playlist URL to expand, or null when the entry has the nested shape but not a URL this
// site accepts -- callers must refuse it rather than drop it.
export type NestedPlaylistRef = { url: string | null };
// How much a site needs a signed-in yt-dlp cookies file, shown in Settings → Sites.
export type SignInLevel = "required" | "recommended" | "optional" | "none";

export type Site = {
  id: SiteId;
  label: string;
  hosts: ReadonlySet<string>;
  // Regexes matched (case-insensitively, full-match) against yt-dlp extractor names.
  extractors: string;
  thumbnailHosts: readonly string[];
  // Hosts (or parent domains) a stream-mode URL from yt-dlp --get-url may point at. Empty means the
  // site can't stream: it only serves HLS/DASH or split audio/video (or needs per-request headers),
  // none of which can be proxied as a single progressive file -- those sources cache instead.
  streamHosts: readonly string[];
  supportsStreaming: boolean;
  channelFeeds: readonly ChannelFeed[];
  // Whether a single "video" URL can expand into several parts/files (yt-dlp returns a playlist).
  multiPartVideos: boolean;
  // Shown when adding a source: a site-specific caveat the operator should know up front.
  note: string | null;
  // What a cookies file does for this site, shown with signIn.level in Settings → Sites.
  signIn: { level: SignInLevel; reason: string };
  // yt-dlp --sleep-requests used when the operator hasn't set one for this site (SiteSetting).
  defaultSleepRequestsSeconds: number;
  // yt-dlp error text meaning the site is refusing this connection (rate limit or bot protection)
  // rather than rejecting one video, on top of the HTTP 429 every site can return. Such failures back
  // off that site's whole queue instead of burning retries (lib/jobs/runner.ts).
  blockedSignal: RegExp | null;
  parse(url: URL): ParsedUrl | null;
  channelFeedUrl(base: string, feed: Exclude<ChannelFeed, "all">): string;
  // Maps one yt-dlp entry (a full extraction or a flat-playlist stub) to a raw ID and canonical watch
  // URL, or null if the entry isn't a shape this site produces. Watch URLs are rebuilt from the ID
  // wherever the site allows, rather than trusted from yt-dlp's output.
  resolveEntry(raw: Raw): EntryRef | null;
  // Recognizes a channel entry that is a nested playlist (see NestedPlaylistRef); null for anything else.
  // Only sites whose channel extractor emits such entries define it.
  nestedPlaylist?(raw: Raw): NestedPlaylistRef | null;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const SAFE_RAW_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

function safeRawId(value: string | null) {
  return value && SAFE_RAW_ID.test(value) && !value.includes("..") ? value : null;
}

function parseUrl(value: string | null) {
  if (!value) return null;
  try { return new URL(value); } catch { return null; }
}

// "?p=N" part number.
function partNumber(value: string | null) {
  return value && /^\d{1,4}$/.test(value) && Number(value) > 0 ? Number(value) : null;
}

// Numeric list/favorites ID from a query parameter, kept as a string (they exceed 4 digits).
function numericParam(value: string | null) {
  return value && /^[1-9]\d{0,19}$/.test(value) ? value : null;
}

// Stable short hash (FNV-1a, 32-bit) for deriving a filename-safe ID from an arbitrary string.
function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

function noFeedSuffix(base: string) {
  return base;
}

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

const youtube: Site = {
  id: "youtube",
  label: "YouTube",
  hosts: new Set([...YOUTUBE_HOSTS, "youtu.be"]),
  extractors: "youtube.*",
  thumbnailHosts: ["ytimg.com", "ggpht.com", "googleusercontent.com", "youtube.com"],
  streamHosts: ["youtube.com", "googlevideo.com"],
  supportsStreaming: true,
  channelFeeds: ["videos", "shorts", "live", "all"],
  multiPartVideos: false,
  note: null,
  signIn: { level: "optional", reason: "Only needed for age-restricted videos, members-only content, or when YouTube asks to confirm you're not a bot." },
  defaultSleepRequestsSeconds: 0,
  blockedSignal: null,
  parse(url) {
    if (url.searchParams.get("list")) return { url: url.toString(), sourceType: "playlist" };
    const parts = url.pathname.split("/").filter(Boolean);
    const first = parts[0] ?? "";
    const videoId = url.hostname === "youtu.be"
      ? first
      : first === "watch"
        ? url.searchParams.get("v")
        : ["shorts", "live", "embed"].includes(first) ? parts[1] : null;
    if (videoId && YOUTUBE_VIDEO_ID.test(videoId)) return { url: `https://www.youtube.com/watch?v=${videoId}`, sourceType: "video" };
    const channelPath = first.startsWith("@") || ["channel", "user", "c"].includes(first);
    if (!YOUTUBE_HOSTS.has(url.hostname) || !channelPath) return null;
    const channel = new URL(url.toString());
    channel.search = "";
    channel.hash = "";
    return { url: channel.toString().replace(/\/$/, ""), sourceType: "channel" };
  },
  channelFeedUrl(base, feed) {
    return `${base.replace(/\/$/, "")}/${feed === "live" ? "streams" : feed}`;
  },
  // Unchanged from before multi-site support: any non-empty ID, yt-dlp's webpage_url when present.
  resolveEntry(raw) {
    const rawId = text(raw.id);
    if (!rawId) return null;
    return { rawId, url: text(raw.webpage_url) ?? `https://www.youtube.com/watch?v=${encodeURIComponent(rawId)}` };
  }
};

const BILIBILI_VIDEO_PATH = /^\/video\/(BV[0-9A-Za-z]{10}|av\d+)\/?$/i;
const BILIBILI_PART_ID = /^(BV[0-9A-Za-z]{10})(?:_p(\d{1,4}))?$/;
const BILIBILI_LIST_EXTRACTOR = /^Bilibili(?:Collection|Series)List$/;

function bilibiliIdFromUrl(value: string | null) {
  const url = parseUrl(value);
  if (!url || !bilibili.hosts.has(url.hostname.toLowerCase())) return null;
  const match = url.pathname.match(BILIBILI_VIDEO_PATH);
  if (!match || !match[1].toUpperCase().startsWith("BV")) return null;
  const part = partNumber(url.searchParams.get("p"));
  return `BV${match[1].slice(2)}${part ? `_p${part}` : ""}`;
}

const bilibili: Site = {
  id: "bilibili",
  label: "Bilibili",
  hosts: new Set(["bilibili.com", "www.bilibili.com", "m.bilibili.com", "space.bilibili.com"]),
  extractors: "bilibili.*",
  thumbnailHosts: ["hdslb.com"],
  // Split DASH streams whose CDN rejects requests without a bilibili.com Referer.
  streamHosts: [],
  supportsStreaming: false,
  // A Bilibili profile has a single uploads list -- no shorts/live tabs to choose between.
  channelFeeds: ["videos"],
  multiPartVideos: true,
  note: null,
  signIn: { level: "recommended", reason: "Without one, Bilibili limits quality to 480p–1080p and blocks bursts of requests (HTTP 412 / “Unable to extract initial state”). A cookies file from a signed-in account avoids both." },
  defaultSleepRequestsSeconds: 1,
  blockedSignal: /Request is blocked by server \(412\)|HTTP Error 412|rejected by server \(352\)|exceeded the rate limit|Unable to extract initial state/i,
  parse(url) {
    const path = url.pathname;
    if (url.hostname === "space.bilibili.com") {
      const profile = path.match(/^\/(\d+)(?:\/(?:upload\/)?video)?\/?$/);
      if (profile) return { url: `https://space.bilibili.com/${profile[1]}/video`, sourceType: "channel" };
      const list = path.match(/^\/(\d+)\/lists\/(\d+)\/?$/);
      if (list) {
        const type = url.searchParams.get("type") === "series" ? "series" : "season";
        return { url: `https://space.bilibili.com/${list[1]}/lists/${list[2]}?type=${type}`, sourceType: "playlist" };
      }
      const legacyList = path.match(/^\/(\d+)\/channel\/(collection|series)detail\/?$/);
      const sid = numericParam(url.searchParams.get("sid"));
      if (legacyList && sid) {
        return { url: `https://space.bilibili.com/${legacyList[1]}/lists/${sid}?type=${legacyList[2] === "series" ? "series" : "season"}`, sourceType: "playlist" };
      }
      const favorites = path.match(/^\/(\d+)\/favlist\/?$/);
      const fid = numericParam(url.searchParams.get("fid"));
      if (favorites && fid) return { url: `https://space.bilibili.com/${favorites[1]}/favlist?fid=${fid}`, sourceType: "playlist" };
      return null;
    }
    const medialist = path.match(/^\/medialist\/detail\/ml(\d+)\/?$/);
    if (medialist) return { url: `https://www.bilibili.com/medialist/detail/ml${medialist[1]}`, sourceType: "playlist" };
    const video = path.match(BILIBILI_VIDEO_PATH);
    if (!video) return null;
    const id = video[1].toUpperCase().startsWith("BV") ? `BV${video[1].slice(2)}` : `av${video[1].slice(2)}`;
    const part = partNumber(url.searchParams.get("p"));
    return { url: `https://www.bilibili.com/video/${id}${part ? `?p=${part}` : ""}`, sourceType: "video" };
  },
  channelFeedUrl: noFeedSuffix,
  // Flat entries for a multi-part video carry only a "?p=N" URL, so the ID may come from there.
  resolveEntry(raw) {
    const rawId = text(raw.id) ?? bilibiliIdFromUrl(text(raw.url));
    const match = rawId?.match(BILIBILI_PART_ID);
    if (!rawId || !match) return null;
    return { rawId, url: `https://www.bilibili.com/video/${match[1]}${match[2] ? `?p=${match[2]}` : ""}` };
  },
  // yt-dlp's profile extractor (BilibiliSpaceVideoIE) emits a "hidden-mode" collection -- one whose
  // videos don't appear in the uploads list itself -- as a flat stub instead of its videos:
  // { _type: "url", ie_key: "BilibiliCollectionList", id: "<mid>_<sid>",
  //   url: "https://space.bilibili.com/<mid>/lists/<sid>?type=season" }.
  // Recognized by extractor key or by a lists URL; the URL is re-parsed through this site's own parse()
  // so only a canonical space.bilibili.com list is ever fetched.
  nestedPlaylist(raw) {
    const ieKey = text(raw.ie_key);
    const url = parseUrl(text(raw.url));
    const listUrl = url?.hostname.toLowerCase() === "space.bilibili.com" && /^\/\d+\/lists\//.test(url.pathname);
    if (!(ieKey && BILIBILI_LIST_EXTRACTOR.test(ieKey)) && !listUrl) return null;
    const parsed = url && url.protocol === "https:" && url.hostname.toLowerCase() === "space.bilibili.com" ? bilibili.parse(url) : null;
    const ids = parsed?.sourceType === "playlist" ? parsed.url.match(/^https:\/\/space\.bilibili\.com\/(\d+)\/lists\/(\d+)\?/) : null;
    if (!parsed || !ids) return { url: null };
    const id = text(raw.id);
    if (id && id !== `${ids[1]}_${ids[2]}`) return { url: null };
    return { url: parsed.url };
  }
};

// bilibili.tv (Bilibili's international site, "Bstation") is a separate service from bilibili.com: its
// own hosts, IDs, API, and yt-dlp extractors (BiliIntl, biliIntl:series). Uploaded videos are
// /video/<aid>; licensed shows are series (/play/<season>, or /media/<id>) of episodes
// (/play/<season>/<ep>). An optional two-letter language prefix (/en/, /th/, ...) is dropped -- yt-dlp
// requests English metadata whatever the prefix -- and every URL is rebuilt on www.bilibili.tv/en/.
// yt-dlp has no extractor for a bilibili.tv uploader's page, so there's no channel source.
const BILIBILI_TV_PATH = /^\/(?:[A-Za-z]{2}\/)?(video|play|media)\/(\d{1,20})(?:\/(\d{1,20}))?\/?$/;
const BILIBILI_TV_RAW_ID = /^(?:\d{1,20}|s\d{1,20}e\d{1,20})$/;

// The raw ID and canonical URL a bilibili.tv video or episode link stands for: "<aid>" for an
// uploaded video, "s<season>e<ep>" for an episode (rebuilding its URL needs both numbers).
function bilibiliTvRef(value: string | null): EntryRef | null {
  const url = parseUrl(value);
  if (!url || !bilibilitv.hosts.has(url.hostname.toLowerCase())) return null;
  const match = url.pathname.match(BILIBILI_TV_PATH);
  if (!match) return null;
  const [, kind, first, second] = match;
  if (kind === "video" && !second) return { rawId: first, url: `https://www.bilibili.tv/en/video/${first}` };
  if (kind === "play" && second) return { rawId: `s${first}e${second}`, url: `https://www.bilibili.tv/en/play/${first}/${second}` };
  return null;
}

const bilibilitv: Site = {
  id: "bilibilitv",
  label: "bilibili.tv",
  hosts: new Set(["bilibili.tv", "www.bilibili.tv", "m.bilibili.tv", "biliintl.com", "www.biliintl.com"]),
  extractors: "biliintl.*",
  thumbnailHosts: ["bstarstatic.com"],
  // Split DASH audio/video.
  streamHosts: [],
  supportsStreaming: false,
  channelFeeds: [],
  multiPartVideos: false,
  note: "Many bilibili.tv shows are region-locked, and some videos need a signed-in yt-dlp cookies file (Settings → External tools).",
  signIn: { level: "optional", reason: "Some shows and videos are only available to signed-in accounts." },
  defaultSleepRequestsSeconds: 0,
  blockedSignal: null,
  parse(url) {
    const match = url.pathname.match(BILIBILI_TV_PATH);
    if (!match) return null;
    const [, kind, first, second] = match;
    if (second) return kind === "play" ? { url: `https://www.bilibili.tv/en/play/${first}/${second}`, sourceType: "video" } : null;
    if (kind === "video") return { url: `https://www.bilibili.tv/en/video/${first}`, sourceType: "video" };
    return { url: `https://www.bilibili.tv/en/${kind}/${first}`, sourceType: "playlist" };
  },
  channelFeedUrl: noFeedSuffix,
  // yt-dlp reports an episode's ID as the bare episode number, which can't rebuild its URL, so the
  // ref comes from the entry's URL (a full extraction's webpage_url, or a flat series stub's url,
  // whose smuggled-data fragment is ignored). The reported ID must agree with that URL.
  resolveEntry(raw) {
    const ref = bilibiliTvRef(text(raw.webpage_url)) ?? bilibiliTvRef(text(raw.url));
    if (!ref || !BILIBILI_TV_RAW_ID.test(ref.rawId)) return null;
    const id = text(raw.id);
    if (id && id !== ref.rawId && !ref.rawId.endsWith(`e${id}`)) return null;
    return ref;
  }
};

const ARCHIVE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

const archive: Site = {
  id: "archive",
  label: "Internet Archive",
  hosts: new Set(["archive.org", "www.archive.org"]),
  extractors: "archive\\.org",
  thumbnailHosts: ["archive.org"],
  // Plain MP4 derivative files over HTTPS (archive.org/download/... redirects to *.us.archive.org).
  streamHosts: ["archive.org"],
  supportsStreaming: true,
  channelFeeds: [],
  // An item with several video files is returned as a playlist of those files.
  multiPartVideos: true,
  note: null,
  signIn: { level: "none", reason: "Public items download without an account." },
  defaultSleepRequestsSeconds: 0,
  blockedSignal: null,
  parse(url) {
    const match = url.pathname.match(/^\/details\/([^/]+)(\/.+)?$/);
    if (!match || !ARCHIVE_IDENTIFIER.test(match[1]) || match[1].includes("..")) return null;
    let file = "";
    if (match[2] && match[2] !== "/") {
      try { file = decodeURIComponent(match[2].slice(1)).replace(/\/$/, ""); } catch { return null; }
      if (file.split("/").some((segment) => !segment || segment === "." || segment === "..")) return null;
    }
    return { url: archiveDetailsUrl(match[1], file), sourceType: "video" };
  },
  channelFeedUrl: noFeedSuffix,
  // A single-file item's ID is its identifier. A file inside a multi-file item is reported as
  // "<identifier>/<file name>" -- not filename-safe -- so it's stored as "<identifier>.f<hash of the
  // file name>", with the watch URL built from the real file name.
  resolveEntry(raw) {
    const id = text(raw.id);
    if (!id) return null;
    const slash = id.indexOf("/");
    const identifier = slash < 0 ? id : id.slice(0, slash);
    const file = slash < 0 ? "" : id.slice(slash + 1);
    if (!safeRawId(identifier) || !ARCHIVE_IDENTIFIER.test(identifier) || (slash >= 0 && !file)) return null;
    return { rawId: file ? `${identifier}.f${fnv1a(file)}` : identifier, url: archiveDetailsUrl(identifier, file) };
  }
};

function archiveDetailsUrl(identifier: string, file: string) {
  return `https://archive.org/details/${identifier}${file ? `/${file.split("/").map(encodeURIComponent).join("/")}` : ""}`;
}

const VIMEO_RESERVED = new Set(["channels", "groups", "album", "showcase", "ondemand", "categories", "watch", "search", "features", "upload", "settings", "home", "watchlater", "log_in", "join", "blog", "help", "solutions", "enterprise", "pricing", "create", "stock", "about", "jobs"]);

const vimeo: Site = {
  id: "vimeo",
  label: "Vimeo",
  hosts: new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]),
  extractors: "vimeo.*",
  thumbnailHosts: ["vimeocdn.com"],
  streamHosts: [],
  supportsStreaming: false,
  channelFeeds: ["videos"],
  multiPartVideos: false,
  note: "Vimeo only serves videos to signed-in clients: set a yt-dlp cookies file from a Vimeo account in Settings → External tools, or every video is marked unavailable.",
  signIn: { level: "required", reason: "Vimeo only serves videos to signed-in clients; without a cookies file every video is marked as requiring sign-in." },
  defaultSleepRequestsSeconds: 0,
  blockedSignal: null,
  parse(url) {
    const path = url.pathname;
    const videoId = url.hostname === "player.vimeo.com"
      ? path.match(/^\/video\/(\d+)\/?$/)?.[1]
      : (path.match(/^\/(\d+)\/?$/) ?? path.match(/^\/channels\/[\w-]+\/(\d+)\/?$/) ?? path.match(/^\/(?:showcase|album)\/\d+\/video\/(\d+)\/?$/) ?? path.match(/^\/groups\/[\w-]+\/videos\/(\d+)\/?$/))?.[1];
    if (videoId) return { url: `https://vimeo.com/${videoId}`, sourceType: "video" };
    if (url.hostname === "player.vimeo.com") return null;
    const channel = path.match(/^\/channels\/([\w-]+)\/?$/);
    if (channel) return { url: `https://vimeo.com/channels/${channel[1]}`, sourceType: "playlist" };
    const showcase = path.match(/^\/(?:showcase|album)\/(\d+)\/?$/);
    if (showcase) return { url: `https://vimeo.com/showcase/${showcase[1]}`, sourceType: "playlist" };
    const user = path.match(/^\/([A-Za-z][\w-]{0,63})(?:\/videos)?\/?$/);
    if (user && !VIMEO_RESERVED.has(user[1].toLowerCase())) return { url: `https://vimeo.com/${user[1]}`, sourceType: "channel" };
    return null;
  },
  channelFeedUrl: noFeedSuffix,
  resolveEntry(raw) {
    const rawId = text(raw.id);
    return rawId && /^\d{1,20}$/.test(rawId) ? { rawId, url: `https://vimeo.com/${rawId}` } : null;
  }
};

const DAILYMOTION_ID = /^x[0-9a-z]{2,20}$/i;
const DAILYMOTION_RESERVED = new Set(["video", "playlist", "search", "embed", "swf", "crawler", "player", "signin", "signup", "settings", "library", "following", "explore", "partner", "upload", "us", "user"]);

const dailymotion: Site = {
  id: "dailymotion",
  label: "Dailymotion",
  hosts: new Set(["dailymotion.com", "www.dailymotion.com", "dai.ly"]),
  extractors: "dailymotion.*",
  thumbnailHosts: ["dmcdn.net"],
  streamHosts: [],
  supportsStreaming: false,
  channelFeeds: ["videos"],
  multiPartVideos: false,
  note: null,
  signIn: { level: "none", reason: "Public videos download without an account." },
  defaultSleepRequestsSeconds: 0,
  blockedSignal: null,
  parse(url) {
    const path = url.pathname;
    const videoId = url.hostname === "dai.ly"
      ? path.match(/^\/([^/_]+)\/?$/)?.[1]
      : path.match(/^\/video\/([^/_?#]+)/)?.[1];
    if (videoId) return DAILYMOTION_ID.test(videoId) ? { url: `https://www.dailymotion.com/video/${videoId}`, sourceType: "video" } : null;
    if (url.hostname === "dai.ly") return null;
    const playlist = path.match(/^\/playlist\/([^/_?#]+)/)?.[1];
    if (playlist) return DAILYMOTION_ID.test(playlist) ? { url: `https://www.dailymotion.com/playlist/${playlist}`, sourceType: "playlist" } : null;
    const user = path.match(/^\/(?:user\/)?([A-Za-z0-9][\w-]{0,63})\/?$/)?.[1];
    if (user && !DAILYMOTION_RESERVED.has(user.toLowerCase())) return { url: `https://www.dailymotion.com/${user}`, sourceType: "channel" };
    return null;
  },
  channelFeedUrl: noFeedSuffix,
  resolveEntry(raw) {
    const rawId = text(raw.id);
    return rawId && DAILYMOTION_ID.test(rawId) ? { rawId, url: `https://www.dailymotion.com/video/${rawId}` } : null;
  }
};

const TWITCH_LOGIN = /^[A-Za-z0-9_]{2,25}$/;
const TWITCH_CLIP_SLUG = /^[A-Za-z0-9_-]{1,100}$/;
const TWITCH_RESERVED = new Set(["videos", "directory", "settings", "downloads", "p", "search", "subscriptions", "inventory", "wallet", "drops", "turbo", "jobs", "store", "prime", "friends", "messages", "payments", "collections", "clip", "clips", "login", "signup", "following"]);

function twitchClipSlug(value: string | null) {
  const url = parseUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const slug = host === "clips.twitch.tv"
    ? url.pathname.match(/^\/([^/]+)\/?$/)?.[1]
    : twitch.hosts.has(host) ? url.pathname.match(/^\/(?:[^/]+\/)?clip\/([^/]+)\/?$/)?.[1] : undefined;
  return slug && TWITCH_CLIP_SLUG.test(slug) && slug !== "embed" ? slug : null;
}

const twitch: Site = {
  id: "twitch",
  label: "Twitch",
  hosts: new Set(["twitch.tv", "www.twitch.tv", "m.twitch.tv", "clips.twitch.tv"]),
  extractors: "twitch.*",
  thumbnailHosts: ["jtvnw.net", "twitch.tv"],
  // VODs and clips are HLS.
  streamHosts: [],
  supportsStreaming: false,
  // A channel's VOD list (past broadcasts, highlights, uploads); a channel's clips are a separate
  // playlist URL (twitch.tv/<channel>/clips).
  channelFeeds: ["videos"],
  multiPartVideos: false,
  note: "Twitch deletes past broadcasts after 7–60 days; TunarrTube keeps anything it already downloaded.",
  signIn: { level: "optional", reason: "Only needed for subscriber-only VODs." },
  defaultSleepRequestsSeconds: 0,
  blockedSignal: null,
  parse(url) {
    const clip = twitchClipSlug(url.toString());
    if (clip) return { url: `https://clips.twitch.tv/${clip}`, sourceType: "video" };
    if (url.hostname === "clips.twitch.tv") return null;
    const path = url.pathname;
    const vod = path.match(/^\/(?:videos|[^/]+\/v(?:ideo)?)\/(\d+)\/?$/)?.[1];
    if (vod) return { url: `https://www.twitch.tv/videos/${vod}`, sourceType: "video" };
    const channel = path.match(/^\/([^/]+)(\/videos|\/clips)?\/?$/);
    if (!channel || !TWITCH_LOGIN.test(channel[1]) || TWITCH_RESERVED.has(channel[1].toLowerCase())) return null;
    const login = channel[1].toLowerCase();
    if (channel[2] === "/clips") return { url: `https://www.twitch.tv/${login}/clips?filter=clips&range=all`, sourceType: "playlist" };
    return { url: `https://www.twitch.tv/${login}`, sourceType: "channel" };
  },
  channelFeedUrl(base) {
    return `${base.replace(/\/$/, "")}/videos?filter=all&sort=time`;
  },
  // VODs are "v<digits>". A clip's ID is numeric but its URL needs the slug (which is also what a
  // pasted clip URL contains), so clips are keyed by slug: from display_id on a full extraction, or the
  // entry URL on a flat clips-list stub.
  resolveEntry(raw) {
    const id = text(raw.id);
    if (id && /^v\d{1,20}$/.test(id)) return { rawId: id, url: `https://www.twitch.tv/videos/${id.slice(1)}` };
    const displayId = text(raw.display_id);
    const slug = (displayId && TWITCH_CLIP_SLUG.test(displayId) && !/^v?\d+$/.test(displayId) ? displayId : null)
      ?? twitchClipSlug(text(raw.webpage_url)) ?? twitchClipSlug(text(raw.url));
    return slug ? { rawId: slug, url: `https://clips.twitch.tv/${slug}` } : null;
  }
};

const NICONICO_VIDEO_ID = /^(?:[a-z]{2})?\d{1,12}$/;

function niconicoIdFromUrl(value: string | null) {
  const url = parseUrl(value);
  const id = url && niconico.hosts.has(url.hostname.toLowerCase()) ? url.pathname.match(/^\/(?:watch\/)?([a-z]{2}\d+|\d+)\/?$/)?.[1] : null;
  return id && NICONICO_VIDEO_ID.test(id) ? id : null;
}

const niconico: Site = {
  id: "niconico",
  label: "Niconico",
  hosts: new Set(["nicovideo.jp", "www.nicovideo.jp", "sp.nicovideo.jp", "nico.ms"]),
  extractors: "niconico.*",
  thumbnailHosts: ["nimg.jp"],
  // Split HLS audio/video.
  streamHosts: [],
  supportsStreaming: false,
  channelFeeds: ["videos"],
  multiPartVideos: false,
  note: "Many Niconico videos need a signed-in yt-dlp cookies file (Settings → External tools), and some are only available in Japan.",
  signIn: { level: "recommended", reason: "Many videos are only available to signed-in accounts." },
  defaultSleepRequestsSeconds: 0,
  blockedSignal: null,
  parse(url) {
    const path = url.pathname;
    if (url.hostname === "nico.ms") {
      const id = path.match(/^\/([a-z]{2}\d+)\/?$/)?.[1];
      return id && NICONICO_VIDEO_ID.test(id) ? { url: `https://www.nicovideo.jp/watch/${id}`, sourceType: "video" } : null;
    }
    const video = path.match(/^\/watch\/([a-z]{2}\d+|\d+)\/?$/)?.[1];
    if (video && NICONICO_VIDEO_ID.test(video)) return { url: `https://www.nicovideo.jp/watch/${video}`, sourceType: "video" };
    const mylist = path.match(/^\/(?:user\/\d+\/)?(?:my\/)?mylist\/(\d+)\/?$/)?.[1];
    if (mylist) return { url: `https://www.nicovideo.jp/mylist/${mylist}`, sourceType: "playlist" };
    const series = path.match(/^\/(?:user\/\d+\/)?series\/(\d+)\/?$/)?.[1];
    if (series) return { url: `https://www.nicovideo.jp/series/${series}`, sourceType: "playlist" };
    const user = path.match(/^\/user\/(\d+)(?:\/video)?\/?$/)?.[1];
    if (user) return { url: `https://www.nicovideo.jp/user/${user}/video`, sourceType: "channel" };
    return null;
  },
  channelFeedUrl: noFeedSuffix,
  // Flat user-upload entries carry only a watch URL.
  resolveEntry(raw) {
    const id = text(raw.id);
    const rawId = id && NICONICO_VIDEO_ID.test(id) ? id : niconicoIdFromUrl(text(raw.url)) ?? niconicoIdFromUrl(text(raw.webpage_url));
    return rawId ? { rawId, url: `https://www.nicovideo.jp/watch/${rawId}` } : null;
  }
};

export const SITES: Readonly<Record<SiteId, Site>> = { youtube, bilibili, bilibilitv, archive, vimeo, dailymotion, twitch, niconico };
export const SUPPORTED_SITE_LABELS = Object.values(SITES).map((site) => site.label).join(", ");

/** The site whose host matches this URL, or null (also for non-HTTPS/unparseable input). */
export function siteForUrl(input: string | URL): Site | null {
  const url = typeof input === "string" ? parseUrl(input) : input;
  if (!url || url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  return Object.values(SITES).find((site) => site.hosts.has(host)) ?? null;
}

/** Non-throwing classification of user input, for client-side form hints. */
export function previewSourceUrl(input: string): SourceUrl | null {
  const url = parseUrl(input.trim());
  const site = url ? siteForUrl(url) : null;
  const parsed = site && url ? site.parse(url) : null;
  return site && parsed ? { ...parsed, site: site.id } : null;
}

/** Like siteForUrl, but for URLs already stored in the DB -- unknown hosts are treated as YouTube. */
export function siteForStoredUrl(input: string): Site {
  return siteForUrl(input) ?? youtube;
}

/** Maps a site's raw ID to the ID stored in Video.youtubeId/Source.youtubeId (see header comment). */
export function storageId(site: Site, rawId: string) {
  return site.id === "youtube" ? rawId : `${site.id}.${rawId}`;
}

export function siteForStoredId(id: string): Site {
  const prefix = id.match(/^([a-z]+)\./)?.[1];
  return prefix && prefix in SITES ? SITES[prefix as SiteId] : youtube;
}

/** Whether a stream URL returned by yt-dlp is on one of the site's allowed stream hosts. */
export function isAllowedStreamUrl(site: Site, value: string) {
  const url = parseUrl(value);
  if (!url || url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return site.streamHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
