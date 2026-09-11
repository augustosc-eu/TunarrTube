// Regression/integration coverage proving the local Claude Code integration is genuinely optional and
// additive: it must not change how the *existing* "auto" provider resolution behaves, and it must only
// ever be reachable through an explicit choice. Deliberately imports the real, unmocked
// resolveAiProvider (unlike tests/programming.test.ts and friends, which stub it out) -- this file is
// what actually exercises lib/programming/provider.ts's dispatch logic itself.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAiProvider } from "@/lib/programming/provider";

const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

describe("resolveAiProvider -- Claude Code is additive, not a change to existing behavior", () => {
  it("\"auto\" with neither API key set still throws AI_PROVIDER_UNCONFIGURED -- exactly today's behavior, never a silent fallback to Claude Code", () => {
    expect(() => resolveAiProvider(null, "auto")).toThrow(/No AI provider is configured/);
  });

  it("\"auto\" with only ANTHROPIC_API_KEY set still resolves to Anthropic, unaffected by Claude Code existing", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(resolveAiProvider(null, "auto").name).toBe("anthropic");
  });

  it("\"auto\" with only OPENAI_API_KEY set still resolves to OpenAI, unaffected by Claude Code existing", () => {
    process.env.OPENAI_API_KEY = "test-key";
    expect(resolveAiProvider(null, "auto").name).toBe("openai");
  });

  it("\"auto\" with both API keys set still throws AI_PROVIDER_AMBIGUOUS -- exactly today's behavior", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.OPENAI_API_KEY = "test-key";
    expect(() => resolveAiProvider(null, "auto")).toThrow(/Both ANTHROPIC_API_KEY and OPENAI_API_KEY/);
  });

  it("resolves \"claude-code\" only when explicitly selected -- never as part of \"auto\"", () => {
    // No API keys and no Claude Code env var set -- "auto" must still fail exactly as it always has.
    expect(() => resolveAiProvider(null, "auto")).toThrow(/No AI provider is configured/);
    // But an explicit choice resolves to it regardless of what API keys are (or aren't) configured.
    expect(resolveAiProvider(null, "claude-code").name).toBe("claude-code");
    expect(resolveAiProvider("claude-code", "auto").name).toBe("claude-code");
  });

  it("an unknown provider string is still rejected exactly as before", () => {
    expect(() => resolveAiProvider(null, "ollama" as never)).toThrow(/Unknown AI provider/);
  });
});
