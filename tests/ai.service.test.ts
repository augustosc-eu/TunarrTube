import { afterEach, describe, expect, it, vi } from "vitest";

const getSettings = vi.fn();
vi.mock("@/lib/settings/service", () => ({ getSettings }));

const inspectClaudeCode = vi.fn();
const runClaudeCode = vi.fn();
vi.mock("@/lib/ai/claude-code", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/claude-code")>();
  return { ...actual, inspectClaudeCode, runClaudeCode };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getClaudeCodeStatus", () => {
  it("merges the CLI availability check with the stored settings", async () => {
    getSettings.mockResolvedValue({ aiClaudeCodeEnabled: true, aiClaudeCodePath: "/custom/claude", aiClaudeCodeTimeoutSeconds: 90 });
    inspectClaudeCode.mockResolvedValue({ available: true, detail: "Claude Code 1.0 detected.", version: "1.0", path: "/custom/claude" });
    const { getClaudeCodeStatus } = await import("@/lib/ai/service");
    const status = await getClaudeCodeStatus();
    expect(status).toMatchObject({ available: true, enabled: true, timeoutSeconds: 90, executablePathOverride: "/custom/claude" });
    expect(inspectClaudeCode).toHaveBeenCalledWith("/custom/claude");
  });
});

describe("assertClaudeCodeEnabled / testClaudeCodeConnection", () => {
  it("refuses to test the connection when the master switch is off", async () => {
    getSettings.mockResolvedValue({ aiClaudeCodeEnabled: false, aiClaudeCodePath: null, aiClaudeCodeTimeoutSeconds: 120 });
    const { testClaudeCodeConnection } = await import("@/lib/ai/service");
    await expect(testClaudeCodeConnection()).rejects.toThrow(/disabled/);
    expect(runClaudeCode).not.toHaveBeenCalled();
  });

  it("runs a fixed canned prompt (never caller-supplied text) and reports latency", async () => {
    getSettings.mockResolvedValue({ aiClaudeCodeEnabled: true, aiClaudeCodePath: null, aiClaudeCodeTimeoutSeconds: 60 });
    runClaudeCode.mockResolvedValue({ text: "OK", costUsd: 0.0005, durationMs: 42 });
    const { testClaudeCodeConnection } = await import("@/lib/ai/service");
    const result = await testClaudeCodeConnection();
    expect(result).toMatchObject({ ok: true, sample: "OK", costUsd: 0.0005 });
    expect(runClaudeCode).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("OK"), timeoutMs: 60_000 }));
  });
});
