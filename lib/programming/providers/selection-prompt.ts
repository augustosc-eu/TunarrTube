import type { SelectContentInput } from "@/lib/programming/providers/types";

// Shared between both providers, same reasoning as prompt.ts's SYSTEM_PROMPT for scheduling.
export const SELECTION_SYSTEM_PROMPT =
  "You are a curator building a TV channel's content lineup. You are given a pool of candidate clips " +
  "and an operator's brief describing what the channel should be. Decide which clips belong on this " +
  "channel. Use clip IDs exactly as given -- do not invent new ones. It is fine to select none of a " +
  "candidate if it genuinely doesn't fit the brief; don't pad the selection with clips that don't belong " +
  "just to reach a target count.";

export function buildSelectionUserPrompt(input: SelectContentInput): string {
  const lines = [
    `Brief from the operator: ${input.instructions}`,
    input.targetCount
      ? `Select approximately ${input.targetCount} clips -- fewer is fine if the pool doesn't support that many good fits, and slightly more is fine if the brief calls for it.`
      : "Select as many or as few clips as genuinely fit the brief.",
    "",
    "Candidate clips (id, title, source, and any known metadata):",
    ...input.candidates.map((candidate) => {
      const meta = [
        candidate.artist ? `artist: ${candidate.artist}` : null,
        candidate.album ? `album: ${candidate.album}` : null,
        candidate.genre ? `genre: ${candidate.genre}` : null,
        candidate.uploadDate ? `uploaded: ${candidate.uploadDate}` : null,
        `duration: ${Math.round(candidate.durationMs / 1000)}s`,
        `from source: ${candidate.sourceName}`
      ].filter(Boolean).join(", ");
      return `- ${candidate.id} :: "${candidate.title}" (${meta})`;
    })
  ];
  return lines.join("\n");
}
