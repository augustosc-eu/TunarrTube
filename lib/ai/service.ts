// Settings-aware wrapper around lib/ai/claude-code.ts -- the only place that reads
// AppSettings.aiClaudeCode* and turns them into calls against the CLI layer. Kept separate from
// claude-code.ts itself so that file stays a pure "run the CLI" module with no DB dependency.
import { AppError } from "@/lib/api";
import { getSettings } from "@/lib/settings/service";
import { DEFAULT_TIMEOUT_MS, inspectClaudeCode, runClaudeCode } from "@/lib/ai/claude-code";
import type { AIAvailability } from "@/lib/ai/types";

export type ClaudeCodeStatusView = AIAvailability & {
  enabled: boolean;
  timeoutSeconds: number;
  executablePathOverride: string | null;
};

// Used by GET /api/ai/status (loaded on every Settings page visit) -- a cheap `--version` check, never
// a real prompt, so it's safe to call often and never costs anything even when a paid API-based
// provider is what's actually configured elsewhere.
export async function getClaudeCodeStatus(): Promise<ClaudeCodeStatusView> {
  const settings = await getSettings();
  const availability = await inspectClaudeCode(settings.aiClaudeCodePath);
  return {
    ...availability,
    enabled: settings.aiClaudeCodeEnabled,
    timeoutSeconds: settings.aiClaudeCodeTimeoutSeconds,
    executablePathOverride: settings.aiClaudeCodePath
  };
}

// The master switch: every caller that's about to actually run a Claude Code prompt (the programming
// plan/content-selection provider adapter, the AI Programming Director, "Test connection") calls this
// first. Centralizing the check here means flipping AppSettings.aiClaudeCodeEnabled off immediately
// stops every feature from invoking the CLI, even one still configured (Source/Channel.aiProvider =
// "claude-code", or leftover instructions) from before it was disabled -- "disabling the AI feature
// leaves zero behavioral impact" holds regardless of what else is still configured.
export async function assertClaudeCodeEnabled() {
  const settings = await getSettings();
  if (!settings.aiClaudeCodeEnabled) {
    throw new AppError("AI_CLAUDE_CODE_DISABLED", "Claude Code integration is disabled. Turn it on under Settings → AI Assistant before using it.", 422);
  }
  return settings;
}

// A fixed, canned round-trip prompt -- never text taken from the request body -- used by the Settings
// "Test connection" button to confirm the CLI is not just present but actually authenticated and
// working end-to-end (inspectClaudeCode only proves the binary responds to --version). Keeping this
// fixed is part of why this feature can never become an unrestricted Claude proxy: this is the only
// prompt TunarrTube will ever send on the browser's behalf with no further validation of its content.
const TEST_PROMPT = "Reply with exactly the single word: OK";

export async function testClaudeCodeConnection() {
  const settings = await assertClaudeCodeEnabled();
  const startedAt = Date.now();
  const response = await runClaudeCode({
    prompt: TEST_PROMPT,
    timeoutMs: (settings.aiClaudeCodeTimeoutSeconds * 1000) || DEFAULT_TIMEOUT_MS,
    executablePath: settings.aiClaudeCodePath
  });
  return { ok: true, latencyMs: Date.now() - startedAt, sample: response.text.trim().slice(0, 200), costUsd: response.costUsd ?? null };
}
