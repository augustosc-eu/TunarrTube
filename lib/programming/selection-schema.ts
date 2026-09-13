import { z } from "zod";

// Validates the raw JSON an AI provider returns for content selection (lib/programming/providers/*)
// before any of it is trusted -- mirrors plan-schema.ts's role for programming plans.
export const contentSelectionSchema = z.object({
  selectedIds: z.array(z.string().min(1)).min(1).max(200)
});

export type ContentSelectionInput = z.infer<typeof contentSelectionSchema>;
