// AI Programming Director: a natural-language front end over the AI Programming feature that already
// exists (lib/programming/ai-service.ts's dayparts/rotation plans). It does not introduce a new
// scheduling engine or a new way to mutate a channel's lineup -- see the module-level comment on
// previewChannelSchedule below for why, and docs/ARCHITECTURE.md for the fuller writeup.
//
// Flow: gather this channel's own already-curated candidates (never a live Tunarr call -- see
// buildDirectorCandidates) -> ask the configured AI provider (lib/programming/provider.ts -- Anthropic,
// OpenAI, or the local Claude Code CLI, whichever is selected) for a plan, exactly like the existing
// "AI Programming" order does on publish -> render that validated plan into a read-only preview (times,
// durations, warnings) -- nothing is persisted or sent to Tunarr here. The caller applies a previewed
// schedule by saving the same channel fields (programmingOrder/aiScheduleStyle/aiProgrammingInstructions/
// aiProvider) the manual "AI Programming" UI already writes, then queuing the same channel_publish job
// the normal Publish button uses (see app/api/channels/{id}/publish/route.ts) -- so an AI-directed
// schedule reaches Tunarr through the exact same, already-tested path as any other AI-scheduled channel.
import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { getSettings } from "@/lib/settings/service";
import { generateProgrammingPlan } from "@/lib/programming/ai-service";
import { scheduleStyleToKind, type AiProviderSetting, type ProgrammingCandidate, type ProgrammingPlan, type ScheduleStyle } from "@/lib/programming/types";

// Local-only candidate gathering (Channel.items' own MediaItem.durationSeconds), deliberately not the
// live-Tunarr-scan duration lib/tunarr/channel-service.ts:publishChannelToTunarr uses once it's
// actually publishing. A schedule *preview* should work without Tunarr being reachable at all -- the
// same reasoning lib/channels/service.ts:runContentSelection already applies to content-selection
// candidates. Durations can differ slightly from the scanned value (rare, e.g. a re-encode), but never
// enough to change which candidates the AI is offered.
export async function buildDirectorCandidates(channelId: string): Promise<ProgrammingCandidate[]> {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    include: { items: { orderBy: { position: "asc" }, include: { mediaItem: true } } }
  });
  if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Channel not found.", 404);
  return channel.items.flatMap((item) => {
    const durationMs = (item.mediaItem.durationSeconds ?? 0) * 1000;
    return durationMs > 0
      ? [{ id: item.mediaItemId, title: item.mediaItem.title, artist: item.mediaItem.artist, album: item.mediaItem.album, genre: item.mediaItem.genre, durationMs, uploadDate: item.mediaItem.releaseDate?.toISOString() ?? null }]
      : [];
  });
}

export type DirectorPreviewItem = { id: string; title: string; durationSeconds: number };
export type DirectorPreviewBlock = { label: string; startMinutes: number; endMinutes: number; items: DirectorPreviewItem[] };
export type DirectorPreviewGroup = { label: string; weight: number; cooldownMinutes: number; items: DirectorPreviewItem[] };

export type DirectorPreview = {
  provider: string;
  kind: "dayparts" | "rotation";
  period: "day" | "week";
  blocks: DirectorPreviewBlock[] | null;
  groups: DirectorPreviewGroup[] | null;
  totalCandidateCount: number;
  usedCandidateCount: number;
  unusedCandidateCount: number;
  warnings: string[];
  plan: ProgrammingPlan;
};

const FILLER_MENTION = /\bfiller\b|\bident\b|\bbumper\b|\bstation id\b/i;

function resolveItems(itemIds: string[], byId: Map<string, ProgrammingCandidate>): DirectorPreviewItem[] {
  return itemIds.flatMap((id) => {
    const candidate = byId.get(id);
    return candidate ? [{ id, title: candidate.title, durationSeconds: Math.round(candidate.durationMs / 1000) }] : [];
  });
}

// Turns a validated ProgrammingPlan (lib/programming/plan-schema.ts already guarantees every itemId is
// a real candidate -- see ai-service.ts:validatePlan) into the read-only, human-facing preview the AI
// Programming Director's UI renders: resolved titles, computed start/end times, and warnings. This is
// pure presentation -- it never touches the database or Tunarr.
function summarizePlan(plan: ProgrammingPlan, provider: string, candidates: ProgrammingCandidate[], instructions: string | null): DirectorPreview {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const warnings: string[] = [];
  const usedIds = new Set<string>();

  let blocks: DirectorPreviewBlock[] | null = null;
  let groups: DirectorPreviewGroup[] | null = null;

  if (plan.kind === "dayparts") {
    const sorted = [...plan.blocks].sort((a, b) => a.startMinutes - b.startMinutes);
    blocks = sorted.map((block) => {
      const items = resolveItems(block.itemIds, byId);
      for (const item of items) usedIds.add(item.id);
      const totalSeconds = items.reduce((sum, item) => sum + item.durationSeconds, 0);
      return { label: block.label, startMinutes: block.startMinutes, endMinutes: block.startMinutes + Math.round(totalSeconds / 60), items };
    });
    for (let index = 0; index < blocks.length - 1; index += 1) {
      const current = blocks[index];
      const next = blocks[index + 1];
      if (current.endMinutes > next.startMinutes) {
        warnings.push(`"${current.label}" runs past the start of "${next.label}" given its clips' total duration -- Tunarr will play "${current.label}"'s last clip on a loop until "${next.label}" begins, rather than actually overlapping.`);
      }
    }
  } else {
    groups = plan.groups.map((group) => {
      const items = resolveItems(group.itemIds, byId);
      for (const item of items) usedIds.add(item.id);
      return { label: group.label, weight: group.weight, cooldownMinutes: group.cooldownMinutes, items };
    });
  }

  const unusedCount = candidates.length - usedIds.size;
  if (unusedCount > 0) {
    warnings.push(`${unusedCount} of ${candidates.length} available clip${candidates.length === 1 ? "" : "s"} on this channel ${unusedCount === 1 ? "was" : "were"} not included in this schedule.`);
  }
  if (instructions && FILLER_MENTION.test(instructions)) {
    warnings.push("Your instructions mention filler/idents/bumpers -- TunarrTube's AI Programming schedules full clips only, not per-item filler insertion. Configure short filler clips separately as a Tunarr \"filler collection\" on this channel (in Tunarr's own channel settings); Tunarr will interleave them automatically between programs.");
  }

  return {
    provider, kind: plan.kind, period: plan.kind === "dayparts" ? plan.period : "day",
    blocks, groups, totalCandidateCount: candidates.length, usedCandidateCount: usedIds.size, unusedCandidateCount: Math.max(0, unusedCount),
    warnings, plan
  };
}

// The AI Programming Director's one real action: given free-text instructions (and the same
// scheduleStyle/aiProvider choices the manual "AI Programming" panel already exposes), gather this
// channel's real candidates, ask the AI for a schedule, validate it (generateProgrammingPlan runs the
// exact same zod schema this app already trusts for manual AI Programming), and return a preview.
// Deliberately calls generateProgrammingPlan (always fresh) rather than ensureProgrammingPlan (which
// would reuse a stale cached plan) -- a preview must reflect exactly the instructions just typed.
export async function previewChannelSchedule(channelId: string, input: {
  instructions: string;
  scheduleStyle: ScheduleStyle;
  providerOverride: string | null | undefined;
  signal?: AbortSignal;
}): Promise<DirectorPreview> {
  const candidates = await buildDirectorCandidates(channelId);
  if (!candidates.length) {
    throw new AppError("AI_NO_CANDIDATES", "This channel has no items with a known duration yet -- add and render at least one media item before asking the AI Programming Director for a schedule.", 422);
  }
  const settings = await getSettings();
  const style = scheduleStyleToKind(input.scheduleStyle);
  const generated = await generateProgrammingPlan({
    candidates, instructions: input.instructions, kind: style.kind, period: style.period,
    providerOverride: input.providerOverride, globalProviderSetting: settings.aiProvider as AiProviderSetting, signal: input.signal
  });
  return summarizePlan(generated.plan, generated.provider, candidates, input.instructions);
}
