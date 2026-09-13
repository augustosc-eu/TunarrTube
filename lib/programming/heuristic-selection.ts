import { AppError } from "@/lib/api";
import type { SelectionCandidate } from "@/lib/programming/providers/types";

// A "Smart" (non-AI) alternative to lib/programming/content-selection.ts:selectContent -- same job
// (attachExistingVideo loop in lib/channels/service.ts:runHeuristicSelection), same candidate pool, but
// a deterministic scoring/ordering algorithm instead of an LLM call. Extends SelectionCandidate with a
// few extra fields the AI path never needed (sourceId for grouping, lastSelectedAt for novelty) --
// additive only, so the AI provider layer is untouched.
export type HeuristicCandidate = SelectionCandidate & {
  sourceId: string;
  lastSelectedAt?: string | null;
};

export type HeuristicSelectionMode = "balanced" | "grouped";

export type HeuristicSelectionInput = {
  candidates: HeuristicCandidate[];
  targetCount?: number;
  mode: HeuristicSelectionMode;
  // Only meaningful when set: nudges scoring toward candidates whose duration is close to this value.
  // Ignored (every candidate scores neutrally on this axis) when omitted.
  targetDurationSeconds?: number;
};

// Matches lib/youtube/ytdlp.ts's own default history-per-sync size -- reused here rather than picking a
// new arbitrary number, since it's already the app's established "a sensible batch, not everything" size.
const DEFAULT_TARGET_COUNT = 100;

// Rank-normalizes `values` (already sorted ascending) into evenly spaced scores in [0, 1], lowest value
// -> 0, highest -> 1. A single value scores 1 (nothing to rank against). Used for both freshness
// (uploadDate) and novelty (lastSelectedAt) so ties and skewed distributions never dominate the scale
// the way a raw timestamp difference would.
function rankScores(count: number): number[] {
  if (count <= 1) return count === 1 ? [1] : [];
  return Array.from({ length: count }, (_, index) => index / (count - 1));
}

// Scores every candidate 0-1 on novelty (never-selected or longest-ago-selected first), freshness
// (newest upload first), and duration fit (closest to targetDurationSeconds, when given), then combines
// them into one candidateScore per id. A candidate missing a signal (no uploadDate, no lastSelectedAt)
// gets a neutral median score on that axis rather than being penalized for missing metadata.
function scoreCandidates(candidates: HeuristicCandidate[], targetDurationSeconds?: number): Map<string, number> {
  const novelty = new Map<string, number>();
  const withSelection = candidates.filter((candidate) => candidate.lastSelectedAt);
  const sortedBySelection = [...withSelection].sort((a, b) => new Date(a.lastSelectedAt!).getTime() - new Date(b.lastSelectedAt!).getTime());
  const selectionRanks = rankScores(sortedBySelection.length);
  sortedBySelection.forEach((candidate, index) => novelty.set(candidate.id, 1 - selectionRanks[index]));
  for (const candidate of candidates) if (!novelty.has(candidate.id)) novelty.set(candidate.id, 1); // never selected -> most novel

  const freshness = new Map<string, number>();
  const withUploadDate = candidates.filter((candidate) => candidate.uploadDate);
  const sortedByUpload = [...withUploadDate].sort((a, b) => new Date(a.uploadDate!).getTime() - new Date(b.uploadDate!).getTime());
  const uploadRanks = rankScores(sortedByUpload.length);
  sortedByUpload.forEach((candidate, index) => freshness.set(candidate.id, uploadRanks[index]));
  for (const candidate of candidates) if (!freshness.has(candidate.id)) freshness.set(candidate.id, 0.5); // unknown upload date -> neutral

  const durationFit = new Map<string, number>();
  if (targetDurationSeconds && targetDurationSeconds > 0) {
    const distances = candidates.map((candidate) => Math.abs(candidate.durationMs / 1000 - targetDurationSeconds));
    const maxDistance = Math.max(...distances, 1);
    candidates.forEach((candidate, index) => durationFit.set(candidate.id, 1 - distances[index] / maxDistance));
  } else {
    for (const candidate of candidates) durationFit.set(candidate.id, 0.5); // no target -> doesn't affect ordering
  }

  const combined = new Map<string, number>();
  for (const candidate of candidates) {
    combined.set(candidate.id, 0.4 * novelty.get(candidate.id)! + 0.35 * freshness.get(candidate.id)! + 0.25 * durationFit.get(candidate.id)!);
  }
  return combined;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    const existing = groups.get(groupKey);
    if (existing) existing.push(item);
    else groups.set(groupKey, [item]);
  }
  return groups;
}

// "balanced" mode: variety across sources/creators is a structural guarantee (true round-robin -- every
// group gets a turn each pass), not just a score weight. Sorting groups by their own best score first
// only decides *priority order within a pass*; it never lets one large, highly-scored source hog every
// remaining slot the way "always take the single best-scoring item across all groups" would once ties
// (or a score lead) make one group win every comparison.
function selectBalanced(candidates: HeuristicCandidate[], scores: Map<string, number>, targetCount: number): string[] {
  const groups = [...groupBy(candidates, (candidate) => candidate.sourceId).values()]
    .map((group) => [...group].sort((a, b) => scores.get(b.id)! - scores.get(a.id)!))
    .sort((a, b) => scores.get(b[0].id)! - scores.get(a[0].id)!);

  const selected: string[] = [];
  for (let madeProgress = true; selected.length < targetCount && madeProgress;) {
    madeProgress = false;
    for (const group of groups) {
      if (selected.length >= targetCount) break;
      const next = group.shift();
      if (next) { selected.push(next.id); madeProgress = true; }
    }
  }
  return selected;
}

// "grouped" mode: block-by-block "marathon" ordering -- pick the best group first (by its members'
// average score), play that whole block in chronological order, then move to the next group. Groups by
// artist when the metadata is present (music content), else by source (the closest thing to a "show" for
// everything else).
function selectGrouped(candidates: HeuristicCandidate[], scores: Map<string, number>, targetCount: number): string[] {
  const groups = [...groupBy(candidates, (candidate) => candidate.artist || `source:${candidate.sourceId}`).values()];
  const ordered = groups
    .map((group) => ({
      group: [...group].sort((a, b) => new Date(a.uploadDate ?? 0).getTime() - new Date(b.uploadDate ?? 0).getTime()),
      averageScore: group.reduce((sum, candidate) => sum + scores.get(candidate.id)!, 0) / group.length
    }))
    .sort((a, b) => b.averageScore - a.averageScore);

  const selected: string[] = [];
  for (const { group } of ordered) {
    for (const candidate of group) {
      if (selected.length >= targetCount) return selected;
      selected.push(candidate.id);
    }
  }
  return selected;
}

export function selectContentHeuristically(input: HeuristicSelectionInput): { selectedIds: string[] } {
  if (!input.candidates.length) {
    throw new AppError("SELECTION_NO_CANDIDATES", "There is nothing to select from yet -- choose a Source with at least one downloaded video.", 422);
  }
  const targetCount = Math.min(input.targetCount ?? Math.min(input.candidates.length, DEFAULT_TARGET_COUNT), input.candidates.length);
  const scores = scoreCandidates(input.candidates, input.targetDurationSeconds);
  const selectedIds = input.mode === "grouped"
    ? selectGrouped(input.candidates, scores, targetCount)
    : selectBalanced(input.candidates, scores, targetCount);
  if (!selectedIds.length) {
    throw new AppError("SELECTION_EMPTY", "No clips matched the current selection criteria.", 422);
  }
  return { selectedIds };
}
