import { afterEach, describe, expect, it, vi } from "vitest";

// Mocks the generic CLI adapter so this file tests only the *adapter* layer (JSON extraction, prompt
// construction, the enable-gate) -- lib/ai/claude-code.test.ts (tests/ai.claude-code.test.ts) already
// covers the real subprocess plumbing underneath it.
const generate = vi.fn();
vi.mock("@/lib/ai/claude-code-provider", () => ({ claudeCodeProvider: { id: "claude-code", name: "Claude Code (Local)", isAvailable: vi.fn(), generate } }));

const getSettings = vi.fn();
vi.mock("@/lib/settings/service", () => ({ getSettings }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("lib/programming/providers/claude-code (AiProvider adapter)", () => {
  it("refuses to run when Claude Code integration is disabled in Settings", async () => {
    getSettings.mockResolvedValue({ aiClaudeCodeEnabled: false, aiClaudeCodePath: null, aiClaudeCodeTimeoutSeconds: 120 });
    const { claudeCodeProvider } = await import("@/lib/programming/providers/claude-code");
    await expect(claudeCodeProvider.generatePlan({ candidates: [], instructions: null, kind: "dayparts", period: "day" })).rejects.toThrow(/disabled/);
    expect(generate).not.toHaveBeenCalled();
  });

  it("parses a raw JSON plan response for generatePlan", async () => {
    getSettings.mockResolvedValue({ aiClaudeCodeEnabled: true, aiClaudeCodePath: null, aiClaudeCodeTimeoutSeconds: 120 });
    generate.mockResolvedValue({ text: '{"kind":"dayparts","period":"day","blocks":[]}', durationMs: 10 });
    const { claudeCodeProvider } = await import("@/lib/programming/providers/claude-code");
    const result = await claudeCodeProvider.generatePlan({ candidates: [], instructions: "test", kind: "dayparts", period: "day" });
    expect(result).toEqual({ kind: "dayparts", period: "day", blocks: [] });
    // The configured 120s is floored to 300s for this call -- see bulkTimeoutMs's comment in
    // lib/programming/providers/claude-code.ts: a background/job-driven call with many candidates
    // shouldn't be capped at the same short default a quick "Test connection" ping uses.
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 300_000 }), undefined);
  });

  it("respects a configured timeout above the 300s floor instead of clamping it down", async () => {
    getSettings.mockResolvedValue({ aiClaudeCodeEnabled: true, aiClaudeCodePath: null, aiClaudeCodeTimeoutSeconds: 480 });
    generate.mockResolvedValue({ text: '{"selectedIds":["a"]}', durationMs: 5 });
    const { claudeCodeProvider } = await import("@/lib/programming/providers/claude-code");
    await claudeCodeProvider.selectContent({ candidates: [], instructions: "brief" });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 480_000 }), undefined);
  });

  it("strips a markdown code fence the model added despite instructions not to", async () => {
    getSettings.mockResolvedValue({ aiClaudeCodeEnabled: true, aiClaudeCodePath: null, aiClaudeCodeTimeoutSeconds: 60 });
    generate.mockResolvedValue({ text: '```json\n{"selectedIds":["a","b"]}\n```', durationMs: 5 });
    const { claudeCodeProvider } = await import("@/lib/programming/providers/claude-code");
    const result = await claudeCodeProvider.selectContent({ candidates: [], instructions: "brief" });
    expect(result).toEqual({ selectedIds: ["a", "b"] });
  });

  it("throws a clear error when the response cannot be parsed as JSON at all", async () => {
    getSettings.mockResolvedValue({ aiClaudeCodeEnabled: true, aiClaudeCodePath: null, aiClaudeCodeTimeoutSeconds: 60 });
    generate.mockResolvedValue({ text: "Sure! Here is a schedule for you.", durationMs: 5 });
    const { claudeCodeProvider } = await import("@/lib/programming/providers/claude-code");
    await expect(claudeCodeProvider.generatePlan({ candidates: [], instructions: null, kind: "rotation", period: "day" })).rejects.toThrow(/could be parsed as JSON/);
  });
});
