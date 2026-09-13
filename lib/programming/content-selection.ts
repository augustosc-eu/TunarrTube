import { AppError } from "@/lib/api";
import { contentSelectionSchema } from "@/lib/programming/selection-schema";
import { resolveAiProvider } from "@/lib/programming/provider";
import type { SelectionCandidate } from "@/lib/programming/providers/types";
import type { AiProviderName, AiProviderSetting } from "@/lib/programming/types";

export type { SelectionCandidate };

// Pure AI orchestration -- no DB access, mirrors lib/programming/ai-service.ts's split between
// "call the provider and validate" (here) and "gather candidates from the DB, apply the result"
// (lib/channels/service.ts:runContentSelection). Unlike a programming plan, a selection isn't cached
// against future publishes -- it's a one-time curation action, not something re-run on republish.
export async function selectContent(input: {
  candidates: SelectionCandidate[];
  instructions: string;
  targetCount?: number;
  providerOverride: string | null | undefined;
  globalProviderSetting: AiProviderSetting;
  signal?: AbortSignal;
}): Promise<{ selectedIds: string[]; provider: AiProviderName }> {
  if (!input.candidates.length) {
    throw new AppError("AI_NO_CANDIDATES", "There is nothing to select from yet -- choose a Source with at least one downloaded video.", 422);
  }
  const provider = resolveAiProvider(input.providerOverride, input.globalProviderSetting);
  const raw = await provider.selectContent({ candidates: input.candidates, instructions: input.instructions, targetCount: input.targetCount }, input.signal);
  const parsed = contentSelectionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("AI_SELECTION_INVALID", `The AI provider's response did not match the expected format: ${parsed.error.issues[0]?.message ?? "unknown validation error"}.`, 502);
  }
  const knownIds = new Set(input.candidates.map((candidate) => candidate.id));
  const selectedIds = parsed.data.selectedIds.filter((id) => knownIds.has(id));
  if (!selectedIds.length) {
    throw new AppError("AI_SELECTION_EMPTY", "The AI provider did not select any of the available clips.", 502);
  }
  return { selectedIds, provider: provider.name };
}
