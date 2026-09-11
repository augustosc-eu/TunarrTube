import { AppError } from "@/lib/api";
import { assertClaudeCodeEnabled } from "@/lib/ai/service";
import { claudeCodeProvider as claudeCodeAdapter } from "@/lib/ai/claude-code-provider";
import { buildUserPrompt, SYSTEM_PROMPT } from "@/lib/programming/providers/prompt";
import { buildSelectionUserPrompt, SELECTION_SYSTEM_PROMPT } from "@/lib/programming/providers/selection-prompt";
import type { AiProvider, GeneratePlanInput, SelectContentInput } from "@/lib/programming/providers/types";

// Adapts the generic lib/ai/claude-code-provider.ts (AIProviderAdapter) into this codebase's existing
// programming-plan AiProvider interface -- the same shape lib/programming/providers/anthropic.ts and
// providers/openai.ts implement, so the local CLI can be selected anywhere the API-key providers can
// (AppSettings.aiProvider, or a Source/Channel's own override) with no change to
// lib/programming/ai-service.ts, lib/programming/content-selection.ts, or anything that calls them.
//
// Unlike the Anthropic/OpenAI providers, Claude Code's CLI has no structured-output/JSON-schema
// enforcement -- it's asked, in plain language, to answer with nothing but a raw JSON object, and the
// response is parsed defensively (including stripping a markdown code fence the model might add despite
// being told not to). The zod schemas in lib/programming/plan-schema.ts and
// lib/programming/selection-schema.ts are what actually enforce the shape server-side either way, exactly
// as they do for the other two providers -- this provider is not trusted any more than they are.
const JSON_ONLY_INSTRUCTION =
  "Respond with ONLY a single raw JSON object matching the shape described below -- no markdown code " +
  "fences, no explanation, no text before or after the JSON.";

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // Strip a ```json ... ``` or ``` ... ``` fence if the model added one despite being told not to.
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    throw new AppError("AI_PROVIDER_INVALID_RESPONSE", "Claude Code did not return a response that could be parsed as JSON.", 502);
  }
}

// AppSettings.aiClaudeCodeTimeoutSeconds (default 120s, same default lib/ai/service.ts's quick "Test
// connection" ping uses) is too short for a real programming-plan/content-selection prompt spanning
// many candidates -- confirmed live: a 5-source content-selection request timed out at 120s, and the
// job's normal retry-on-failure then repeated the *same* slow prompt from scratch, roughly doubling the
// user's wait before it was cancelled. Both calls below are either a background Job the caller already
// polls for (content_select, tunarr_publish/channel_publish) or a Director preview the UI already shows
// a spinner for -- never a fire-and-forget quick ping -- so there's no UX reason to cap them at the same
// short default a "Test connection" click uses. Floor (never lower) the effective timeout at 5 minutes;
// an operator who explicitly configured something longer in Settings still gets their own value.
const MIN_BULK_TIMEOUT_SECONDS = 300;
function bulkTimeoutMs(configuredSeconds: number) {
  return Math.max(configuredSeconds, MIN_BULK_TIMEOUT_SECONDS) * 1000;
}

const DAYPARTS_SCHEMA_HINT =
  '{"kind":"dayparts","period":"day"|"week","blocks":[{"label":string,"startMinutes":integer,"itemIds":[string,...]}]}';
const ROTATION_SCHEMA_HINT =
  '{"kind":"rotation","groups":[{"label":string,"itemIds":[string,...],"weight":number,"cooldownMinutes":integer|null}]}';
const SELECTION_SCHEMA_HINT = '{"selectedIds":[string,...]}';

export const claudeCodeProvider: AiProvider = {
  name: "claude-code",
  async generatePlan(input: GeneratePlanInput, signal?: AbortSignal): Promise<unknown> {
    const settings = await assertClaudeCodeEnabled();
    const schemaHint = input.kind === "rotation" ? ROTATION_SCHEMA_HINT : DAYPARTS_SCHEMA_HINT;
    const response = await claudeCodeAdapter.generate({
      systemPrompt: `${SYSTEM_PROMPT} ${JSON_ONLY_INSTRUCTION} JSON shape: ${schemaHint}`,
      prompt: buildUserPrompt(input),
      timeoutMs: bulkTimeoutMs(settings.aiClaudeCodeTimeoutSeconds)
    }, signal);
    return extractJson(response.text);
  },
  async selectContent(input: SelectContentInput, signal?: AbortSignal): Promise<unknown> {
    const settings = await assertClaudeCodeEnabled();
    const response = await claudeCodeAdapter.generate({
      systemPrompt: `${SELECTION_SYSTEM_PROMPT} ${JSON_ONLY_INSTRUCTION} JSON shape: ${SELECTION_SCHEMA_HINT}`,
      prompt: buildSelectionUserPrompt(input),
      timeoutMs: bulkTimeoutMs(settings.aiClaudeCodeTimeoutSeconds)
    }, signal);
    return extractJson(response.text);
  }
};
