// Generic, feature-agnostic AI provider abstraction -- deliberately separate from
// lib/programming/providers/types.ts's AiProvider (which is scoped to the programming-plan/
// content-selection schemas). This one exists so a future AI feature that isn't about scheduling
// (or a future provider that isn't Claude Code -- a direct Anthropic API key, OpenAI, Ollama, etc.)
// can be added without threading programming-specific types through it. lib/programming/providers/
// claude-code.ts is the adapter that lets the *existing* AiProvider dispatch reuse this one.
export type AIRequest = {
  // Prepended as the CLI's system prompt (Claude Code's `--append-system-prompt` is intentionally
  // not used here -- a plain system-prompt-style prefix keeps this provider interchangeable with a
  // hypothetical future HTTP-based provider that only takes a flat prompt/system pair).
  systemPrompt?: string;
  prompt: string;
  // Overrides AppSettings.aiClaudeCodeTimeoutSeconds for this one call.
  timeoutMs?: number;
};

export type AIResponse = {
  // Raw text Claude produced. Callers that expect JSON (every current caller) parse this themselves --
  // this layer never assumes the response is JSON, since a future non-scheduling feature might want
  // plain text.
  text: string;
  // Present when the underlying CLI reported it (Claude Code's `--output-format json` envelope
  // includes a USD cost estimate) -- purely informational, never required by callers.
  costUsd?: number | null;
  durationMs: number;
};

export type AIAvailability = {
  available: boolean;
  // Human-readable reason, always present -- e.g. "Claude Code 1.2.3 detected." or "Claude Code was
  // not detected or is not authenticated. Install Claude Code and run `claude` once from Terminal to
  // sign in." Shown directly in Settings, so it never contains a stack trace or raw stderr.
  detail: string;
  version: string | null;
  path: string | null;
};

export interface AIProviderAdapter {
  readonly id: string;
  readonly name: string;
  // Cheap-ish check (a `--version` call, not a real prompt) -- safe to call on every Settings page
  // load. Never throws; failures are reported through the returned AIAvailability instead.
  isAvailable(): Promise<AIAvailability>;
  generate(request: AIRequest, signal?: AbortSignal): Promise<AIResponse>;
}
