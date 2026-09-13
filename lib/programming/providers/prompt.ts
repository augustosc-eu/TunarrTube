import type { GeneratePlanInput } from "@/lib/programming/providers/types";

// Shared between both providers so switching TUNARRTUBE_AI_PROVIDER never changes what the model is
// asked to do -- only which API answers. Kind-specific guidance is appended in buildUserPrompt below
// rather than duplicated into two full system prompts, since the shared ground rules (use exact IDs,
// don't invent or drop clips) apply identically to both.
export const SYSTEM_PROMPT =
  "You are a TV channel programmer. You are given a list of video clips and must arrange them into a " +
  "schedule, in one of two shapes depending on what you're asked for: \"dayparts\" (named blocks at " +
  "fixed start times, like a broadcast schedule) or \"rotation\" (named groups with a relative weight " +
  "and cooldown, shuffled endlessly with no fixed times, like a radio rotation). " +
  "Use every clip ID exactly as given -- do not invent new ones, and do not omit a clip unless the " +
  "user's instructions say to.";

const DAYPARTS_GUIDANCE =
  "Produce a \"dayparts\" plan: named blocks (e.g. \"Morning\", \"Primetime\"), each with a start time " +
  "(minutes from midnight for a daily schedule, or minutes from the start of Monday for a weekly one) " +
  "and an ordered list of clip IDs. Blocks must not overlap: order them by startMinutes and make sure a " +
  "block's clips fit before the next block's start time given each clip's durationMs. " +
  "A block that runs out of clips before its slot ends will have its last clip repeat on a loop for the " +
  "rest of that block, every day, until the next block starts -- so give each block enough clips (in " +
  "total duration) to roughly cover the real time until the next block begins, unless you only have one " +
  "or two clips total to work with. A single clip left alone in an hours-long block is almost always a " +
  "mistake, not a deliberate choice -- either add more clips to that block or shrink the block (move the " +
  "next block's start time earlier) to match how much content you actually gave it.";

const ROTATION_GUIDANCE =
  "Produce a \"rotation\" plan: named groups (e.g. \"Deep Cuts\", \"Hits\"), each with an unordered list " +
  "of clip IDs, a weight (a plain positive number, relative to the other groups' weights -- a group " +
  "weighted 3 plays about 3x as often as one weighted 1, not a percentage), and optionally a cooldown in " +
  "minutes (the minimum time before that same group can be picked again -- higher for groups you want to " +
  "feel rare or special, lower for ones that should recur often; omit it to accept a sensible default). " +
  "There is no schedule to fill and no start times -- Tunarr shuffles within and across groups forever, " +
  "picking one clip at a time weighted by group.";

export function buildUserPrompt(input: GeneratePlanInput): string {
  const lines = [
    input.kind === "rotation"
      ? ROTATION_GUIDANCE
      : `${DAYPARTS_GUIDANCE}\nSchedule period: ${input.period === "week" ? "one repeating week (minutes measured from Monday 00:00)" : "one repeating day (minutes measured from midnight)"}.`,
    input.instructions ? `Instructions from the operator: ${input.instructions}` : "No specific instructions were given -- use your judgment to group similar clips sensibly.",
    "",
    "Clips (id, title, and any known metadata):",
    ...input.candidates.map((candidate) => {
      const meta = [
        candidate.artist ? `artist: ${candidate.artist}` : null,
        candidate.album ? `album: ${candidate.album}` : null,
        candidate.genre ? `genre: ${candidate.genre}` : null,
        candidate.uploadDate ? `uploaded: ${candidate.uploadDate}` : null,
        `duration: ${Math.round(candidate.durationMs / 1000)}s`
      ].filter(Boolean).join(", ");
      return `- ${candidate.id} :: "${candidate.title}" (${meta})`;
    })
  ];
  return lines.join("\n");
}
