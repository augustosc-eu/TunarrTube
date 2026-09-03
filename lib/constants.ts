import path from "node:path";

export const PROJECT_ROOT = process.cwd();
export const DEFAULT_MEDIA_ROOT = path.join(PROJECT_ROOT, "storage", "media");
export const JOB_TYPES = {
  DOWNLOAD: "download",
  METADATA: "metadata",
  SYNC: "sync"
} as const;

export const JOB_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETE: "complete",
  FAILED: "failed",
  CANCELLED: "cancelled"
} as const;
