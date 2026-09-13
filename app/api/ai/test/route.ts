import { ok, toErrorResponse } from "@/lib/api";
import { testClaudeCodeConnection } from "@/lib/ai/service";

// Runs one real Claude Code round-trip with a fixed, server-defined prompt (see TEST_PROMPT in
// lib/ai/service.ts) -- deliberately takes no request body, so this can never become a pass-through for
// arbitrary prompts from the browser.
export const runtime = "nodejs";

export async function POST() {
  try {
    return ok(await testClaudeCodeConnection());
  } catch (error) {
    return toErrorResponse(error);
  }
}
