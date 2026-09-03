import { db } from "@/lib/db/client";

type LogInput = {
  level?: "info" | "warn" | "error";
  category: string;
  message: string;
  sourceId?: string;
  videoId?: string;
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
      details: input.details ? sanitizeLogValue(JSON.stringify(input.details)) : undefined
    }
  });
}
