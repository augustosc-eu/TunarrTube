import { db } from "@/lib/db/client";

type LogInput = {
  level?: "info" | "warn" | "error";
  category: string;
  message: string;
  sourceId?: string;
  videoId?: string;
  channelId?: string;
  mediaItemId?: string;
  details?: unknown;
};

const SIGNED_URL = /https?:\/\/[^\s"']*(?:googlevideo|youtube)[^\s"']*/gi;

export function sanitizeLogValue(value: string) {
  return value.replace(SIGNED_URL, "[redacted-url]").replace(/(--cookies(?:-from-browser)?\s+)\S+/gi, "$1[redacted]");
}

export async function writeLog(input: LogInput) {
  return db.logEntry.create({
    data: {
      level: input.level ?? "info",
      category: input.category,
      message: sanitizeLogValue(input.message),
      sourceId: input.sourceId,
      videoId: input.videoId,
      channelId: input.channelId,
      mediaItemId: input.mediaItemId,
      details: input.details ? sanitizeLogValue(JSON.stringify(input.details)) : undefined
    }
  });
}

// Deletes LogEntry rows older than `retentionDays` (or every row, when `clear` is set) so the table
// doesn't grow without bound -- mirrors enforceCachePolicy's shape in lib/cache/service.ts. Takes the
// retention window as a parameter rather than importing lib/settings/service directly, since that module
// already imports writeLog from here and a mutual import would create a cycle.
export async function purgeLogs(retentionDays: number, clear = false) {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const { count } = await db.logEntry.deleteMany(clear ? undefined : { where: { createdAt: { lt: cutoff } } });
  if (count) await writeLog({ category: "maintenance", message: clear ? `Cleared all log entries (${count} removed).` : `Purged ${count} log entr${count === 1 ? "y" : "ies"} older than ${retentionDays} day${retentionDays === 1 ? "" : "s"}.` });
  return { deleted: count, retentionDays, clear };
}
