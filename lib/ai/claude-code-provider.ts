// The literal ClaudeCodeProvider: implements the generic AIProviderAdapter (lib/ai/types.ts) on top of
// lib/ai/claude-code.ts's CLI invocation. Usable standalone by any future AI feature -- today it's
// consumed two ways: lib/programming/providers/claude-code.ts adapts it into the existing
// programming-plan AiProvider, and lib/programming/director.ts (AI Programming Director) calls it
// directly for its own prompt/schema.
import { inspectClaudeCode, runClaudeCode } from "@/lib/ai/claude-code";
import type { AIAvailability, AIProviderAdapter, AIRequest, AIResponse } from "@/lib/ai/types";

export const claudeCodeProvider: AIProviderAdapter = {
  id: "claude-code",
  name: "Claude Code (Local)",
  isAvailable(): Promise<AIAvailability> {
    return inspectClaudeCode();
  },
  generate(request: AIRequest, signal?: AbortSignal): Promise<AIResponse> {
    return runClaudeCode({ prompt: request.prompt, systemPrompt: request.systemPrompt, timeoutMs: request.timeoutMs, signal });
  }
};
