// Local Claude Code CLI integration -- runs the already-authenticated `claude` executable as a child
// process instead of calling the Anthropic API with a key. This module owns everything specific to
// invoking that CLI (discovery, the concurrency/timeout/input-length guards, and parsing its
// `--output-format json` envelope); lib/ai/claude-code-provider.ts wraps it as an AIProviderAdapter,
// and lib/programming/providers/claude-code.ts further adapts that into the programming-plan-specific
// AiProvider so it can be selected anywhere the existing anthropic/openai providers are.
//
// Nothing in this file runs unless something explicitly calls into it -- there is no module-level
// side effect, no invocation from app startup/instrumentation.ts, and every exported function fails
// gracefully (returns/throws a normal result) rather than crashing the process if `claude` is missing.
import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppError } from "@/lib/api";
import { sanitizeLogValue } from "@/lib/logging/service";
import { runProcess } from "@/lib/system/process";
import { writeLog } from "@/lib/logging/service";
import type { AIAvailability, AIResponse } from "@/lib/ai/types";

// Input length protection: bounds how much prompt text (system + user, combined) TunarrTube will ever
// hand to the CLI in one call. The user-supplied prompt travels over the child's stdin (see
// runClaudeCode below), not argv, so this isn't bounded by the OS's process-argument-size limit
// (Linux caps a single argv string at ~128KB regardless of the total ARG_MAX, which a large
// programming-plan prompt -- one line per candidate clip -- could realistically exceed; stdin has no
// such per-string cap). 1,000,000 chars (~250K tokens) is still well under Claude's context window and
// large enough for a channel with hundreds of candidates, while still refusing a truly pathological
// request with a clear error instead of a very slow/expensive CLI call.
export const MAX_PROMPT_CHARS = 1_000_000;

// Timeout bounds for AppSettings.aiClaudeCodeTimeoutSeconds -- clamped here rather than only in the
// zod schema so any caller that constructs a timeout directly (tests, the availability check) is also
// protected against an accidental 0 or unbounded value.
export const MIN_TIMEOUT_MS = 10_000;
export const MAX_TIMEOUT_MS = 600_000;
export const DEFAULT_TIMEOUT_MS = 120_000;

// Concurrency protection: caps how many `claude` child processes TunarrTube will run at once, across
// every caller (AI Programming, content selection, the AI Programming Director, the Settings "Test
// connection" button). Claude Code sessions are heavier than a yt-dlp/ffmpeg invocation -- without this,
// a page that fires off several AI calls in a loop (or several browser tabs each publishing an
// AI-scheduled channel) could launch dozens of concurrent `claude` processes. A plain module-level
// counter is sufficient because this app assumes a single running instance (see AGENTS.md).
const MAX_CONCURRENT_RUNS = 2;
let activeRuns = 0;

function clampTimeout(timeoutMs: number | undefined) {
  const value = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, value));
}

async function executable(candidate: string) {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Resolution order: an explicit override (AppSettings.aiClaudeCodePath, passed in by callers -- highest
// priority since it's a deliberate operator choice made through the Settings UI), then the
// TUNARRTUBE_CLAUDE_PATH env var (matching the TUNARRTUBE_YTDLP_PATH/TUNARRTUBE_FFMPEG_PATH convention
// in lib/system/binaries.ts), then `which claude`, then a short list of common install locations
// (npm global installs, and Claude Code's own self-managed installer, which places the binary under
// ~/.claude/local/ and symlinks it onto PATH -- listed here only as a fallback for a shell that didn't
// pick up that symlink, e.g. this app running under a different user/service account).
async function fallbackPaths() {
  const home = os.homedir();
  return [
    path.join(home, ".claude", "local", "claude"),
    path.join(home, ".npm-global", "bin", "claude"),
    path.join(home, ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude"
  ];
}

export async function discoverClaudeExecutable(overridePath?: string | null): Promise<string | null> {
  if (overridePath && (await executable(overridePath))) return overridePath;
  if (overridePath) return null; // an explicit override that doesn't resolve is not worth falling back past
  const envOverride = process.env.TUNARRTUBE_CLAUDE_PATH;
  if (envOverride && (await executable(envOverride))) return envOverride;
  try {
    const result = await runProcess("which", ["claude"], { timeoutMs: 5000 });
    const candidate = result.stdout.trim().split("\n")[0];
    if (candidate && (await executable(candidate))) return candidate;
  } catch {}
  for (const candidate of await fallbackPaths()) if (await executable(candidate)) return candidate;
  return null;
}

// Lightweight availability check (`claude --version`) -- safe to call on every Settings page load and
// before every real invocation. Never throws: a missing/broken CLI is reported through the returned
// AIAvailability, matching inspectBinary()'s contract in lib/system/binaries.ts. This never runs a real
// prompt, so it says nothing about whether the CLI is *authenticated* -- only "Test connection"
// (testClaudeCodeConnection in lib/ai/service.ts) actually confirms that end-to-end.
export async function inspectClaudeCode(overridePath?: string | null): Promise<AIAvailability> {
  const executablePath = await discoverClaudeExecutable(overridePath);
  if (!executablePath) {
    return {
      available: false,
      path: null,
      version: null,
      detail: "Claude Code was not detected or is not authenticated. Install Claude Code and run `claude` once from Terminal to sign in."
    };
  }
  try {
    const result = await runProcess(executablePath, ["--version"], { timeoutMs: 15_000 });
    const version = result.stdout.trim().split("\n")[0] || null;
    return { available: true, path: executablePath, version, detail: version ? `Claude Code ${version} detected at ${executablePath}.` : `Claude Code detected at ${executablePath}.` };
  } catch (error) {
    return {
      available: false,
      path: executablePath,
      version: null,
      detail: `Found a \`claude\` executable at ${executablePath}, but it did not respond to --version: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

type ClaudeJsonEnvelope = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number | null;
  duration_ms?: number;
};

function parseEnvelope(stdout: string): ClaudeJsonEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new AppError("AI_CLAUDE_CODE_INVALID_OUTPUT", "Claude Code did not return valid JSON. It may have printed extra text, or this Claude Code version's --output-format json shape has changed.", 502);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new AppError("AI_CLAUDE_CODE_INVALID_OUTPUT", "Claude Code's JSON response was not an object.", 502);
  }
  return parsed as ClaudeJsonEnvelope;
}

export type RunClaudeCodeInput = {
  prompt: string;
  systemPrompt?: string;
  timeoutMs?: number;
  executablePath?: string | null;
  signal?: AbortSignal;
};

// Runs one non-interactive Claude Code turn and returns its text result. Every argument is passed as a
// real array element to spawn (via lib/system/process.ts:runProcess) -- never through a shell -- so
// nothing in the prompt can be interpreted as a shell metacharacter, and the caller can never inject
// extra CLI flags: this function accepts exactly a prompt/system-prompt pair, nothing resembling a raw
// argv. The main prompt is written to the child's stdin rather than passed as a `-p <value>` argv
// element (confirmed against a real Claude Code install: `claude -p` with no positional prompt argument
// reads it from stdin) -- keeping arbitrarily large candidate-list prompts off argv, where a single
// string is capped well below 1MB on Linux (the platform this app actually ships on via Docker)
// regardless of the OS's total argument-list limit. The system prompt (this app's own fixed
// instructions, not user/candidate data -- always a few hundred bytes) stays on argv via
// --append-system-prompt, which has no such size concern.
export async function runClaudeCode(input: RunClaudeCodeInput): Promise<AIResponse> {
  const combinedLength = input.prompt.length + (input.systemPrompt?.length ?? 0);
  if (combinedLength > MAX_PROMPT_CHARS) {
    throw new AppError("AI_CLAUDE_CODE_INPUT_TOO_LARGE", `This request is too large for the local Claude Code provider (${combinedLength.toLocaleString()} characters, limit ${MAX_PROMPT_CHARS.toLocaleString()}). Try narrowing the request (fewer candidates, shorter instructions).`, 413);
  }
  if (activeRuns >= MAX_CONCURRENT_RUNS) {
    throw new AppError("AI_CLAUDE_CODE_BUSY", `TunarrTube is already running ${activeRuns} Claude Code request${activeRuns === 1 ? "" : "s"} -- please wait for it to finish before starting another.`, 429);
  }
  // Reserve a concurrency slot synchronously, in the same tick as the check above -- everything else in
  // this function (discovery, mkdtemp, the actual process) is async, and if the increment happened after
  // any of those awaits, two calls that both pass the check before either increments could both proceed
  // (a classic check-then-act race across interleaved async calls). Reserving the slot before the first
  // await closes that window: no other call can observe activeRuns before this one has already
  // incremented it.
  activeRuns += 1;
  try {
    const executablePath = await discoverClaudeExecutable(input.executablePath);
    if (!executablePath) {
      throw new AppError("AI_CLAUDE_CODE_NOT_FOUND", "Claude Code was not detected or is not authenticated. Install Claude Code and run `claude` once from Terminal to sign in.", 422);
    }

    // No positional prompt argument -- with -p/--print and nothing following it, Claude Code reads the
    // prompt from stdin (verified directly against a real install; see runClaudeCode's comment above).
    const args = ["-p", "--output-format", "json", "--max-turns", "1"];
    if (input.systemPrompt) args.push("--append-system-prompt", input.systemPrompt);
    // Never let this call use tools (Bash/Read/Write/WebFetch/...) -- it's invoked purely as a
    // language-model inference process, matching this feature's security constraints (no
    // filesystem/repository access, no arbitrary tool invocation, no command execution). --restricted
    // additionally removes command/code-running tools and WebFetch at the source, confines any
    // remaining file tools to the working directory, and (load-bearing here) ignores project/user/local
    // settings files so a stray CLAUDE.md/hook/MCP config on the host can't reintroduce tool access or
    // extra instructions; --tools "" is the CLI's own documented way to disable every tool outright,
    // combined for defense in depth. With --max-turns 1 on top, there is no opportunity for a tool call
    // to run even if one were somehow attempted.
    args.push("--restricted", "--tools", "");

    const runCwd = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-claude-"));
    const startedAt = Date.now();
    try {
      const result = await runProcess(executablePath, args, {
        cwd: runCwd,
        stdin: input.prompt,
        timeoutMs: clampTimeout(input.timeoutMs),
        signal: input.signal
      });
      const envelope = parseEnvelope(result.stdout);
      if (envelope.is_error || (envelope.subtype && envelope.subtype !== "success")) {
        const reason = envelope.result ? sanitizeLogValue(envelope.result).slice(0, 500) : "Claude Code reported an error.";
        throw new AppError("AI_CLAUDE_CODE_ERROR", `Claude Code did not complete this request: ${reason}`, 502);
      }
      if (typeof envelope.result !== "string" || !envelope.result.trim()) {
        throw new AppError("AI_CLAUDE_CODE_EMPTY_RESPONSE", "Claude Code returned an empty response.", 502);
      }
      // Never log the prompt or the full response -- only that a call happened, how long it took, and
      // its (non-sensitive) cost estimate, matching AGENTS.md's "sanitize before logging" rule.
      await writeLog({ category: "ai", message: `Claude Code request completed in ${Date.now() - startedAt}ms${typeof envelope.total_cost_usd === "number" ? ` (~$${envelope.total_cost_usd.toFixed(4)})` : ""}.` });
      return { text: envelope.result, costUsd: envelope.total_cost_usd ?? null, durationMs: Date.now() - startedAt };
    } catch (error) {
      if (error instanceof AppError && error.code === "PROCESS_TIMEOUT") {
        throw new AppError("AI_CLAUDE_CODE_TIMEOUT", `Claude Code did not respond within ${Math.round(clampTimeout(input.timeoutMs) / 1000)}s. Try again, increase the timeout in Settings, or simplify the request.`, 504);
      }
      throw error;
    } finally {
      await rm(runCwd, { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    activeRuns -= 1;
  }
}
