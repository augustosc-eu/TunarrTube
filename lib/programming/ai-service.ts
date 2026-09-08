import { createHash } from "node:crypto";
import { AppError } from "@/lib/api";
import { programmingPlanSchema } from "@/lib/programming/plan-schema";
import { resolveAiProvider } from "@/lib/programming/provider";
import type { AiProviderSetting, ProgrammingCandidate, ProgrammingKind, ProgrammingPlan, StoredProgrammingPlan } from "@/lib/programming/types";

const DEFAULT_COOLDOWN_MINUTES = 30;

// Deterministic fingerprint of "what the AI was asked to schedule" -- candidate ids/titles/durations,
// the instructions text, and the requested kind. Used only to decide whether a cached plan
// (Source/Channel.aiProgrammingPlanJson) is still valid; not a security boundary, so a fast, unsalted
// hash is fine.
function signature(candidates: ProgrammingCandidate[], instructions: string | null, kind: ProgrammingKind) {
  const hash = createHash("sha256");
  const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  hash.update(JSON.stringify(sorted.map((c) => [c.id, c.title, c.durationMs])));
  hash.update(" ");
  hash.update(instructions ?? "");
  hash.update(" ");
  hash.update(kind);
  return hash.digest("hex");
}

function validatePlan(raw: unknown, candidates: ProgrammingCandidate[]): ProgrammingPlan {
  const parsed = programmingPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("AI_PLAN_INVALID", `The AI provider's response did not match the expected schedule format: ${parsed.error.issues[0]?.message ?? "unknown validation error"}.`, 502);
  }
  const knownIds = new Set(candidates.map((candidate) => candidate.id));

  if (parsed.data.kind === "dayparts") {
    const blocks = parsed.data.blocks
      .map((block) => ({ ...block, itemIds: block.itemIds.filter((id) => knownIds.has(id)) }))
      .filter((block) => block.itemIds.length > 0)
      .sort((a, b) => a.startMinutes - b.startMinutes);
    if (!blocks.length) {
      throw new AppError("AI_PLAN_EMPTY", "The AI provider's schedule did not reference any of the available clips.", 502);
    }
    return { kind: "dayparts", period: parsed.data.period, blocks };
  }

  const groups = parsed.data.groups
    .map((group) => ({
      label: group.label,
      itemIds: group.itemIds.filter((id) => knownIds.has(id)),
      weight: group.weight,
      cooldownMinutes: group.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES
    }))
    .filter((group) => group.itemIds.length > 0);
  if (!groups.length) {
    throw new AppError("AI_PLAN_EMPTY", "The AI provider's rotation did not reference any of the available clips.", 502);
  }
  return { kind: "rotation", groups };
}

export async function generateProgrammingPlan(input: {
  candidates: ProgrammingCandidate[];
  instructions: string | null;
  kind: ProgrammingKind;
  period: "day" | "week";
  providerOverride: string | null | undefined;
  globalProviderSetting: AiProviderSetting;
  signal?: AbortSignal;
}): Promise<StoredProgrammingPlan> {
  if (!input.candidates.length) {
    throw new AppError("AI_NO_CANDIDATES", "There is nothing to schedule yet -- add or download at least one video first.", 422);
  }
  const provider = resolveAiProvider(input.providerOverride, input.globalProviderSetting);
  const raw = await provider.generatePlan({ candidates: input.candidates, instructions: input.instructions, kind: input.kind, period: input.period }, input.signal);
  const plan = validatePlan(raw, input.candidates);
  return {
    plan,
    provider: provider.name,
    instructions: input.instructions,
    candidatesSignature: signature(input.candidates, input.instructions, input.kind),
    generatedAt: new Date().toISOString()
  };
}

// Regenerates only when there's no cached plan, the candidate set/instructions/schedule kind changed
// since it was generated, or a different provider is now selected -- a republish with nothing changed
// reuses the cached plan instead of spending another AI call.
export async function ensureProgrammingPlan(input: {
  cached: StoredProgrammingPlan | null;
  candidates: ProgrammingCandidate[];
  instructions: string | null;
  kind: ProgrammingKind;
  period: "day" | "week";
  providerOverride: string | null | undefined;
  globalProviderSetting: AiProviderSetting;
  signal?: AbortSignal;
}): Promise<StoredProgrammingPlan> {
  const provider = resolveAiProvider(input.providerOverride, input.globalProviderSetting);
  const currentSignature = signature(input.candidates, input.instructions, input.kind);
  if (input.cached && input.cached.provider === provider.name && input.cached.candidatesSignature === currentSignature) {
    return input.cached;
  }
  const fresh = await generateProgrammingPlan(input);
  // Carry forward the previous publish's Tunarr Custom Show/slot IDs so schedule-builder.ts can still
  // match blocks/groups by label and update in place, even though the plan content itself changed. If
  // the schedule kind itself changed (dayparts <-> rotation), the label set is unrelated to the old
  // one anyway, so stale entries just go unused rather than causing harm.
  return { ...fresh, tunarr: input.cached?.tunarr };
}
