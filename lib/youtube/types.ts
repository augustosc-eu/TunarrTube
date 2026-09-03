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
