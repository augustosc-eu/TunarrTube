import OpenAI from "openai";
import { AppError } from "@/lib/api";
import { buildUserPrompt, SYSTEM_PROMPT } from "@/lib/programming/providers/prompt";
import { buildSelectionUserPrompt, SELECTION_SYSTEM_PROMPT } from "@/lib/programming/providers/selection-prompt";
import type { AiProvider, GeneratePlanInput, SelectContentInput } from "@/lib/programming/providers/types";

// Hand-written to mirror lib/programming/plan-schema.ts's zod discriminated union exactly (OpenAI's
// structured outputs take a plain JSON Schema, not a zod instance) -- keep the two in sync if either
// changes. "additionalProperties: false" + every property listed in "required" is required by OpenAI's
// strict mode on every object in the schema, not just the top level.
const DAYPARTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "period", "blocks"],
  properties: {
    kind: { type: "string", const: "dayparts" },
    period: { type: "string", enum: ["day", "week"] },
    blocks: {
      type: "array",
      minItems: 1,
      maxItems: 48,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "startMinutes", "itemIds"],
        properties: {
          label: { type: "string" },
          startMinutes: { type: "integer", minimum: 0, maximum: 7 * 24 * 60 - 1 },
          itemIds: { type: "array", minItems: 1, maxItems: 500, items: { type: "string" } }
        }
      }
    }
  }
} as const;

const ROTATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "groups"],
  properties: {
    kind: { type: "string", const: "rotation" },
    groups: {
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        // OpenAI strict mode requires every property in "required" even if conceptually optional --
        // cooldownMinutes may be null, which ai-service.ts treats the same as omitted.
        required: ["label", "itemIds", "weight", "cooldownMinutes"],
        properties: {
          label: { type: "string" },
          itemIds: { type: "array", minItems: 1, maxItems: 500, items: { type: "string" } },
          weight: { type: "number", exclusiveMinimum: 0, maximum: 1000 },
          cooldownMinutes: { type: ["integer", "null"], minimum: 0, maximum: 1440 }
        }
      }
    }
  }
} as const;

// The caller already knows which kind it wants (it's a Source/Channel setting chosen before
// generation, not something the model decides) -- pick the matching single-kind schema rather than
// asking the model to also choose between an anyOf of both. Simpler and more reliable than relying on
// OpenAI structured-outputs' union support.
function planJsonSchemaFor(kind: GeneratePlanInput["kind"]) {
  return kind === "rotation" ? ROTATION_JSON_SCHEMA : DAYPARTS_JSON_SCHEMA;
}

// Mirrors lib/programming/selection-schema.ts's zod schema exactly, same convention as the two plan
// schemas above.
const SELECTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["selectedIds"],
  properties: {
    selectedIds: { type: "array", minItems: 1, maxItems: 200, items: { type: "string" } }
  }
} as const;

// Not user-selectable beyond this env override -- unlike the Anthropic side (pinned to claude-opus-5),
// OpenAI's current recommended model at the time this was written may no longer be current by the time
// you read this; confirm against OpenAI's own model documentation before relying on the default.
const MODEL = process.env.TUNARRTUBE_OPENAI_MODEL ?? "gpt-4o";

export const openaiProvider: AiProvider = {
  name: "openai",
  async generatePlan(input: GeneratePlanInput, signal?: AbortSignal): Promise<unknown> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new AppError("AI_PROVIDER_UNCONFIGURED", "OPENAI_API_KEY is not set.", 422);
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) }
      ],
      response_format: { type: "json_schema", json_schema: { name: "programming_plan", strict: true, schema: planJsonSchemaFor(input.kind) } }
    }, { signal });
    const content = response.choices[0]?.message?.content;
    if (response.choices[0]?.finish_reason === "content_filter") {
      throw new AppError("AI_PROVIDER_REFUSED", "OpenAI declined to generate a programming plan for this request.", 422);
    }
    if (!content) throw new AppError("AI_PROVIDER_INVALID_RESPONSE", "OpenAI did not return a schedule.", 502);
    try {
      return JSON.parse(content);
    } catch {
      throw new AppError("AI_PROVIDER_INVALID_RESPONSE", "OpenAI returned a response that was not valid JSON.", 502);
    }
  },
  async selectContent(input: SelectContentInput, signal?: AbortSignal): Promise<unknown> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new AppError("AI_PROVIDER_UNCONFIGURED", "OPENAI_API_KEY is not set.", 422);
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SELECTION_SYSTEM_PROMPT },
        { role: "user", content: buildSelectionUserPrompt(input) }
      ],
      response_format: { type: "json_schema", json_schema: { name: "content_selection", strict: true, schema: SELECTION_JSON_SCHEMA } }
    }, { signal });
    const content = response.choices[0]?.message?.content;
    if (response.choices[0]?.finish_reason === "content_filter") {
      throw new AppError("AI_PROVIDER_REFUSED", "OpenAI declined to select content for this request.", 422);
    }
    if (!content) throw new AppError("AI_PROVIDER_INVALID_RESPONSE", "OpenAI did not return a selection.", 502);
    try {
      return JSON.parse(content);
    } catch {
      throw new AppError("AI_PROVIDER_INVALID_RESPONSE", "OpenAI returned a response that was not valid JSON.", 502);
    }
  }
};
