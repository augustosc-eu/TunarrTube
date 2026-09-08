import { z } from "zod";

// Validates the raw JSON an AI provider returns (lib/programming/providers/*) before any of it is
// trusted -- this is the only gate between model output and the code that turns a plan into real
// Tunarr Custom Shows, so it stays intentionally strict (no passthrough fields, bounded array sizes).
export const programmingBlockSchema = z.object({
  label: z.string().trim().min(1).max(120),
  startMinutes: z.number().int().min(0).max(7 * 24 * 60 - 1),
  itemIds: z.array(z.string().min(1)).min(1).max(500)
});

export const programmingGroupSchema = z.object({
  label: z.string().trim().min(1).max(120),
  itemIds: z.array(z.string().min(1)).min(1).max(500),
  weight: z.number().positive().max(1000),
  // Optional on the wire (the AI often has no opinion) -- ai-service.ts fills a default when absent.
  // Accepts both undefined (Anthropic can omit it outright) and null (OpenAI's strict structured
  // outputs require every property to be listed in the schema's "required", so an "optional" field is
  // represented as nullable instead of actually-optional -- see providers/openai.ts).
  cooldownMinutes: z.number().int().min(0).max(1440).nullable().optional()
});

export const daypartsPlanSchema = z.object({
  kind: z.literal("dayparts"),
  period: z.enum(["day", "week"]),
  blocks: z.array(programmingBlockSchema).min(1).max(48)
});

export const rotationPlanSchema = z.object({
  kind: z.literal("rotation"),
  groups: z.array(programmingGroupSchema).min(1).max(24)
});

export const programmingPlanSchema = z.discriminatedUnion("kind", [daypartsPlanSchema, rotationPlanSchema]);

export type ProgrammingPlanInput = z.infer<typeof programmingPlanSchema>;
