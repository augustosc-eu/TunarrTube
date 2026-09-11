import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AppError } from "@/lib/api";
import { daypartsPlanSchema, rotationPlanSchema } from "@/lib/programming/plan-schema";
import { contentSelectionSchema } from "@/lib/programming/selection-schema";
import { buildUserPrompt, SYSTEM_PROMPT } from "@/lib/programming/providers/prompt";
import { buildSelectionUserPrompt, SELECTION_SYSTEM_PROMPT } from "@/lib/programming/providers/selection-prompt";
import type { AiProvider, GeneratePlanInput, SelectContentInput } from "@/lib/programming/providers/types";

// claude-opus-5 per this project's default model choice; not user-configurable today since AGENTS.md's
// env-var convention (TUNARRTUBE_YTDLP_PATH-style) is reserved for binaries/URLs, not model selection --
// revisit if a second model tier turns out to be worth the extra setting.
const MODEL = "claude-opus-5";

export const anthropicProvider: AiProvider = {
  name: "anthropic",
  async generatePlan(input: GeneratePlanInput, signal?: AbortSignal): Promise<unknown> {
    const apiKey = process.env.TUNARRTUBE_ANTHROPIC_API_KEY;
    if (!apiKey) throw new AppError("AI_PROVIDER_UNCONFIGURED", "TUNARRTUBE_ANTHROPIC_API_KEY is not set.", 422);
    const client = new Anthropic({ apiKey });
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16_000,
      system: SYSTEM_PROMPT,
      // The caller already fixed which kind it wants (a Source/Channel setting, not the model's
      // choice) -- ask for the matching single-kind schema rather than the full discriminated union,
      // same reasoning as providers/openai.ts.
      output_config: { format: zodOutputFormat(input.kind === "rotation" ? rotationPlanSchema : daypartsPlanSchema) },
      messages: [{ role: "user", content: buildUserPrompt(input) }]
    }, { signal });
    if (response.stop_reason === "refusal") {
      throw new AppError("AI_PROVIDER_REFUSED", "Claude declined to generate a programming plan for this request.", 422);
    }
    if (!response.parsed_output) {
      throw new AppError("AI_PROVIDER_INVALID_RESPONSE", "Claude did not return a schedule that matched the expected format.", 502);
    }
    return response.parsed_output;
  },
  async selectContent(input: SelectContentInput, signal?: AbortSignal): Promise<unknown> {
    const apiKey = process.env.TUNARRTUBE_ANTHROPIC_API_KEY;
    if (!apiKey) throw new AppError("AI_PROVIDER_UNCONFIGURED", "TUNARRTUBE_ANTHROPIC_API_KEY is not set.", 422);
    const client = new Anthropic({ apiKey });
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16_000,
      system: SELECTION_SYSTEM_PROMPT,
      output_config: { format: zodOutputFormat(contentSelectionSchema) },
      messages: [{ role: "user", content: buildSelectionUserPrompt(input) }]
    }, { signal });
    if (response.stop_reason === "refusal") {
      throw new AppError("AI_PROVIDER_REFUSED", "Claude declined to select content for this request.", 422);
    }
    if (!response.parsed_output) {
      throw new AppError("AI_PROVIDER_INVALID_RESPONSE", "Claude did not return a selection that matched the expected format.", 502);
    }
    return response.parsed_output;
  }
};
