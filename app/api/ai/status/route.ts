import { ok, toErrorResponse } from "@/lib/api";
import { getClaudeCodeStatus } from "@/lib/ai/service";

// Cheap, read-only availability check (`claude --version`, never a real prompt) -- safe to call on
// every Settings page load. Never runs at app startup; see lib/ai/claude-code.ts's module comment.
export const runtime = "nodejs";

export async function GET() {
  try {
    return ok(await getClaudeCodeStatus());
  } catch (error) {
    return toErrorResponse(error);
  }
}
