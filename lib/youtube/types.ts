export type PlaylistEntry = {
  youtubeId: string;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  uploadDate: Date | null;
  thumbnailUrl: string | null;
  uploader: string | null;
  youtubeUrl: string;
  playlistIndex: number | null;
  availability: "available" | "unavailable" | "unknown";
  // Only ever populated from a full (non-flat-playlist) yt-dlp fetch -- see normalizeEntry in
  // normalize.ts. YouTube supplies these for videos it has tagged as official music content; most
  // videos leave them null, and flat-playlist sync entries never carry them at all.
  artist: string | null;
  album: string | null;
};

export type PlaylistAnalysis = {
  youtubeId: string;
  name: string;
  uploaderName: string | null;
  thumbnailUrl: string | null;
  url: string;
  entries: PlaylistEntry[];
  sourceType: "playlist" | "channel" | "collection";
  feedType: "playlist" | "videos" | "shorts" | "live" | "all" | "manual";
  historyLimit: number | null;
};

export type ChannelFeed = "videos" | "shorts" | "live" | "all";
export type AnalyzeSourceOptions = { feedType?: ChannelFeed; historyLimit?: number | null };
