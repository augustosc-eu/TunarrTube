import type { ProgrammingCandidate, ProgrammingKind } from "@/lib/programming/types";

export type GeneratePlanInput = {
  candidates: ProgrammingCandidate[];
  instructions: string | null;
  kind: ProgrammingKind;
  // Only meaningful for kind: "dayparts" -- ignored (but still present) for "rotation".
  period: "day" | "week";
};

// A candidate for AI *content selection* (lib/programming/content-selection.ts) -- distinct from
// ProgrammingCandidate (which schedules already-curated clips) in that it also carries which Source it
// came from, so the AI can reason about "the best of source X" across a pool spanning several Sources.
export type SelectionCandidate = ProgrammingCandidate & { sourceName: string };

export type SelectContentInput = {
  candidates: SelectionCandidate[];
  instructions: string;
  // Guidance only, never enforced -- the AI is told to use its judgment when absent.
  targetCount?: number;
};

// Each provider returns raw, untyped JSON -- lib/programming/ai-service.ts (generatePlan) and
// lib/programming/content-selection.ts (selectContent) run the same zod schema over whichever
// provider ran, so neither is trusted more than the other and a malformed response is caught
// identically regardless of which one produced it.
export type AiProvider = {
  name: "anthropic" | "openai";
  generatePlan(input: GeneratePlanInput, signal?: AbortSignal): Promise<unknown>;
  selectContent(input: SelectContentInput, signal?: AbortSignal): Promise<unknown>;
};
