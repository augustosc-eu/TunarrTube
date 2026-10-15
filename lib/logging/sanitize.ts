// Kept free of imports so low-level modules (lib/api.ts) can redact without pulling in Prisma.
const SIGNED_URL = /https?:\/\/[^\s"']*(?:googlevideo|youtube)[^\s"']*/gi;

export function sanitizeLogValue(value: string) {
  return value.replace(SIGNED_URL, "[redacted-url]").replace(/(--cookies(?:-from-browser)?\s+)\S+/gi, "$1[redacted]");
}
