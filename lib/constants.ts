import path from "node:path";

export const PROJECT_ROOT = process.cwd();
export const DEFAULT_MEDIA_ROOT = path.join(PROJECT_ROOT, "storage", "media");

// Channel-generator domain roots. RENDER_CACHE_ROOT/RENDERS_ROOT are render-cache-shaped (freely
// rebuildable, hardlinked into a channel's own storage directory at publish time) and stay under
// the fixed process-relative storage root, same as channel-generator's original design. A
// Channel's own storageDirectory (the directory Tunarr actually scans, analogous to a Source's
// mediaDirectory) is instead derived per-call from the *configurable* AppSettings.mediaBaseDirectory
// -- see lib/channels/service.ts -- namespaced under "_channels" so it can never collide with a
// Source's own directoryName (a plain slugify() output, which never starts with "_").
export const RENDER_CACHE_ROOT = path.join(PROJECT_ROOT, "storage", "render-cache");
export const RENDERS_ROOT = path.join(DEFAULT_MEDIA_ROOT, "_renders");

// yt-dlp's own cache (notably the yt-dlp-ejs challenge-solver script it downloads on first use -- see
// lib/youtube/ytdlp.ts's CHALLENGE_SOLVER_ARGS) defaults to XDG_CACHE_HOME/~/.cache, which isn't
// guaranteed to exist, be writable, or persist across restarts. Same process-relative-storage pattern as
// RENDER_CACHE_ROOT above so it persists identically in a native install (under the project directory)
// and in Docker (the tunarrtube-storage volume already mounted over /app/storage in compose.yaml).
export const YTDLP_CACHE_ROOT = path.join(PROJECT_ROOT, "storage", "yt-dlp-cache");
// Hidden work directories TunarrTube creates inside media directories: the playback cache (under the
// media base directory) and per-download temp roots (next to each download target). Dot-prefixed so Tunarr
// and other media scanners skip them.
export const CACHE_DIRECTORY_NAME = "._tunarrtube-cache";
export const TEMP_DIRECTORY_NAME = "._tunarrtube-tmp";
export const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".mov", ".m4v", ".webm", ".avi"];

export const JOB_TYPES = {
  DOWNLOAD: "download",
  METADATA: "metadata",
  SYNC: "sync",
  RENDER: "render",
  INGEST_LOCAL_SCAN: "ingest_local_scan",
  CHANNEL_PUBLISH: "channel_publish"
} as const;

export const JOB_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETE: "complete",
  FAILED: "failed",
  CANCELLED: "cancelled"
} as const;
