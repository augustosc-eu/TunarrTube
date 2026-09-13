import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverClaudeExecutable, inspectClaudeCode, MIN_TIMEOUT_MS, runClaudeCode } from "@/lib/ai/claude-code";

const cleanup: string[] = [];
const originalPath = process.env.PATH;

afterEach(async () => {
  delete process.env.TUNARRTUBE_CLAUDE_PATH;
  process.env.PATH = originalPath;
  vi.restoreAllMocks();
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

// Neutralizes every discovery path discoverClaudeExecutable falls through to besides the one under
// test -- an empty PATH so `which claude` can't find a real install on the machine running these tests,
// and a fake, empty HOME so the hardcoded install-location fallbacks (~/.local/bin/claude, etc.) can't
// either. Without this, "nothing is found anywhere"-style tests are only true on a machine that happens
// not to have Claude Code installed -- exactly the kind of environment-dependent flake that bit this
// suite once a real `claude` was installed on the dev machine mid-project.
async function neutralizeDiscovery() {
  const fakeHome = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-claude-fakehome-"));
  cleanup.push(fakeHome);
  vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
  process.env.PATH = fakeHome;
}

// Writes a fake `claude` executable (a tiny Node script) and points either TUNARRTUBE_CLAUDE_PATH or an
// explicit override path at it -- mirrors tests/binaries.test.ts's fakeYtDlp helper. Exercising the real
// spawn/argv-parsing path (rather than mocking child_process) is what actually proves argument passing,
// timeouts, and JSON parsing work.
async function fakeClaude(script: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-claude-test-"));
  cleanup.push(root);
  const binary = path.join(root, "claude");
  await writeFile(binary, `#!/usr/bin/env node\n${script}\n`);
  await chmod(binary, 0o755);
  return binary;
}

describe("discoverClaudeExecutable", () => {
  it("returns null when nothing is found anywhere", async () => {
    await neutralizeDiscovery();
    process.env.TUNARRTUBE_CLAUDE_PATH = "/definitely/not/a/real/path/claude";
    await expect(discoverClaudeExecutable()).resolves.toBeNull();
  });

  it("prefers an explicit override over the environment variable", async () => {
    const envBinary = await fakeClaude('console.log("env");');
    const overrideBinary = await fakeClaude('console.log("override");');
    process.env.TUNARRTUBE_CLAUDE_PATH = envBinary;
    await expect(discoverClaudeExecutable(overrideBinary)).resolves.toBe(overrideBinary);
  });

  it("returns null (never falls back) when an explicit override does not resolve", async () => {
    const envBinary = await fakeClaude('console.log("env");');
    process.env.TUNARRTUBE_CLAUDE_PATH = envBinary;
    await expect(discoverClaudeExecutable("/nonexistent/claude")).resolves.toBeNull();
  });
});

describe("inspectClaudeCode", () => {
  it("reports unavailable with a helpful message when Claude Code is not installed", async () => {
    await neutralizeDiscovery();
    process.env.TUNARRTUBE_CLAUDE_PATH = "/definitely/not/a/real/path/claude";
    const status = await inspectClaudeCode();
    expect(status.available).toBe(false);
    expect(status.detail).toMatch(/not detected or is not authenticated/);
  });

  it("reports available with the detected version", async () => {
    const binary = await fakeClaude('process.stdout.write("1.2.3 (Claude Code)\\n");');
    const status = await inspectClaudeCode(binary);
    expect(status).toMatchObject({ available: true, path: binary, version: "1.2.3 (Claude Code)" });
  });
});

const okEnvelope = { type: "result", subtype: "success", is_error: false, result: '{"ok":true}', total_cost_usd: 0.001 };

// Reads the whole prompt back off stdin (fd 0) -- runClaudeCode writes the prompt there rather than as
// a `-p <value>` argv element (see claude-code.ts's comment on why: a single argv string is capped well
// below 1MB on Linux, the platform this app ships on via Docker, regardless of the OS's total
// argument-list limit; stdin has no such per-string cap). Confirmed against a real Claude Code install
// that `-p` with no positional argument reads the prompt from stdin.
const READ_STDIN = `const prompt = require("fs").readFileSync(0, "utf8");`;

describe("runClaudeCode", () => {
  it("invokes the CLI with -p/--output-format json/--max-turns 1, writes the prompt to stdin (not argv), and parses the result", async () => {
    const binary = await fakeClaude(`
      ${READ_STDIN}
      const args = process.argv.slice(2);
      process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify({ prompt, flags: args }), total_cost_usd: 0.002 }));
    `);
    const response = await runClaudeCode({ prompt: "hello world", executablePath: binary });
    const parsed = JSON.parse(response.text);
    expect(parsed.prompt).toBe("hello world");
    // The prompt itself must never appear on argv.
    expect(parsed.flags).not.toContain("hello world");
    expect(parsed.flags).toContain("--output-format");
    expect(parsed.flags).toContain("json");
    expect(parsed.flags).toContain("--max-turns");
    expect(parsed.flags).toContain("1");
    // Tool use is disabled two ways: --restricted (removes command/code-running tools and WebFetch,
    // ignores stray project/user settings files) and --tools "" (the CLI's own documented "disable
    // every tool" flag) -- see claude-code.ts's comment for why both.
    expect(parsed.flags).toContain("--restricted");
    expect(parsed.flags).toContain("--tools");
    expect(response.costUsd).toBe(0.002);
  });

  it("passes prompt text containing shell metacharacters through untouched via stdin (no shell interpolation)", async () => {
    const binary = await fakeClaude(`
      ${READ_STDIN}
      process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: prompt }));
    `);
    const dangerous = '$(echo pwned); rm -rf / #';
    const response = await runClaudeCode({ prompt: dangerous, executablePath: binary });
    expect(response.text).toBe(dangerous);
  });

  it("delivers a prompt well over the old argv-based limit (the exact size class that triggered the original bug report) via stdin", async () => {
    const binary = await fakeClaude(`
      ${READ_STDIN}
      process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: String(prompt.length) }));
    `);
    const huge = "Clip candidate line.\n".repeat(8000); // ~168,000 chars -- what the user actually hit
    expect(huge.length).toBeGreaterThan(120_000);
    const response = await runClaudeCode({ prompt: huge, executablePath: binary });
    expect(Number(response.text)).toBe(huge.length);
  });

  it("throws a clear error when the executable cannot be found", async () => {
    await expect(runClaudeCode({ prompt: "hi", executablePath: "/nonexistent/claude" })).rejects.toThrow(/not detected or is not authenticated/);
  });

  it("throws on a non-zero exit code with the CLI's stderr surfaced", async () => {
    const binary = await fakeClaude('process.stderr.write("auth error: not logged in"); process.exit(1);');
    await expect(runClaudeCode({ prompt: "hi", executablePath: binary })).rejects.toThrow(/auth error/);
  });

  it("throws a clear error on malformed (non-JSON) stdout", async () => {
    const binary = await fakeClaude('process.stdout.write("not json at all");');
    await expect(runClaudeCode({ prompt: "hi", executablePath: binary })).rejects.toThrow(/valid JSON/);
  });

  it("throws when the CLI's own envelope reports an error", async () => {
    const binary = await fakeClaude(`process.stdout.write(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, result: "ran out of turns" }));`);
    await expect(runClaudeCode({ prompt: "hi", executablePath: binary })).rejects.toThrow(/ran out of turns/);
  });

  it("throws when the CLI reports success but with an empty result", async () => {
    const binary = await fakeClaude(`process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "" }));`);
    await expect(runClaudeCode({ prompt: "hi", executablePath: binary })).rejects.toThrow(/empty response/);
  });

  it("kills the process and throws a timeout error when the CLI hangs", async () => {
    const binary = await fakeClaude('setTimeout(() => {}, 60_000);'); // never exits on its own
    // A requested timeoutMs below MIN_TIMEOUT_MS is clamped up to it (see clampTimeout in
    // lib/ai/claude-code.ts) -- pass MIN_TIMEOUT_MS directly so this test waits exactly that long.
    await expect(runClaudeCode({ prompt: "hi", executablePath: binary, timeoutMs: MIN_TIMEOUT_MS })).rejects.toThrow(/did not respond within/);
  }, MIN_TIMEOUT_MS + 5_000);

  it("rejects a prompt over the input length limit before ever spawning a process", async () => {
    const huge = "x".repeat(1_000_001);
    await expect(runClaudeCode({ prompt: huge, executablePath: "/should/not/be/reached" })).rejects.toThrow(/too large/);
  });

  it("limits concurrent invocations and rejects extra concurrent calls", async () => {
    const binary = await fakeClaude(`
      setTimeout(() => {
        process.stdout.write(JSON.stringify(${JSON.stringify(okEnvelope)}));
        process.exit(0);
      }, 300);
    `);
    const calls = [
      runClaudeCode({ prompt: "a", executablePath: binary }),
      runClaudeCode({ prompt: "b", executablePath: binary }),
      runClaudeCode({ prompt: "c", executablePath: binary })
    ];
    const results = await Promise.allSettled(calls);
    const rejected = results.filter((result) => result.status === "rejected");
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    // MAX_CONCURRENT_RUNS is 2 -- the third concurrent call must be rejected as busy, not queued.
    expect(fulfilled.length).toBe(2);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/already running/);
  });
});
