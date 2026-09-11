import { describe, expect, it } from "vitest";
import { selectContentHeuristically, type HeuristicCandidate } from "@/lib/programming/heuristic-selection";

function candidate(overrides: Partial<HeuristicCandidate> & { id: string }): HeuristicCandidate {
  return { title: overrides.id, durationMs: 120_000, sourceName: "Source", sourceId: "source-a", ...overrides };
}

describe("selectContentHeuristically", () => {
  it("throws when there are no candidates to choose from", () => {
    expect(() => selectContentHeuristically({ candidates: [], mode: "balanced" })).toThrow(/nothing to select/);
  });

  it("defaults targetCount to the full pool when it's smaller than the 100 default", () => {
    const candidates = [candidate({ id: "a" }), candidate({ id: "b" }), candidate({ id: "c" })];
    const result = selectContentHeuristically({ candidates, mode: "balanced" });
    expect(result.selectedIds).toHaveLength(3);
  });

  it("caps selection at the requested targetCount", () => {
    const candidates = [candidate({ id: "a" }), candidate({ id: "b" }), candidate({ id: "c" })];
    const result = selectContentHeuristically({ candidates, mode: "balanced", targetCount: 2 });
    expect(result.selectedIds).toHaveLength(2);
  });

  it("prefers never-selected clips over recently-selected ones (novelty)", () => {
    const candidates = [
      candidate({ id: "stale", lastSelectedAt: new Date().toISOString() }),
      candidate({ id: "fresh", lastSelectedAt: null })
    ];
    const result = selectContentHeuristically({ candidates, mode: "balanced", targetCount: 1 });
    expect(result.selectedIds).toEqual(["fresh"]);
  });

  it("prefers newer uploads over older ones (freshness) when novelty is tied", () => {
    const candidates = [
      candidate({ id: "old", uploadDate: "2020-01-01T00:00:00.000Z" }),
      candidate({ id: "new", uploadDate: "2024-01-01T00:00:00.000Z" })
    ];
    const result = selectContentHeuristically({ candidates, mode: "balanced", targetCount: 1 });
    expect(result.selectedIds).toEqual(["new"]);
  });

  it("prefers clips whose duration is closest to the target duration", () => {
    const candidates = [
      candidate({ id: "short", durationMs: 30_000 }),
      candidate({ id: "just-right", durationMs: 300_000 }),
      candidate({ id: "long", durationMs: 3_000_000 })
    ];
    const result = selectContentHeuristically({ candidates, mode: "balanced", targetCount: 1, targetDurationSeconds: 300 });
    expect(result.selectedIds).toEqual(["just-right"]);
  });

  it("balanced mode spreads selection across sources instead of exhausting the largest one first", () => {
    const candidates = [
      ...Array.from({ length: 10 }, (_, index) => candidate({ id: `big-${index}`, sourceId: "big-source" })),
      candidate({ id: "small-1", sourceId: "small-source" })
    ];
    const result = selectContentHeuristically({ candidates, mode: "balanced", targetCount: 4 });
    expect(result.selectedIds).toContain("small-1");
  });

  it("grouped mode keeps each artist's/source's clips together as a block", () => {
    const candidates = [
      candidate({ id: "artist-a-1", artist: "Artist A", uploadDate: "2023-01-01T00:00:00.000Z" }),
      candidate({ id: "artist-a-2", artist: "Artist A", uploadDate: "2023-06-01T00:00:00.000Z" }),
      candidate({ id: "artist-b-1", artist: "Artist B", uploadDate: "2023-03-01T00:00:00.000Z" })
    ];
    const result = selectContentHeuristically({ candidates, mode: "grouped", targetCount: 3 });
    const artistABlock = result.selectedIds.filter((id) => id.startsWith("artist-a"));
    // Chronological within the block: the earlier upload comes first.
    expect(artistABlock).toEqual(["artist-a-1", "artist-a-2"]);
    // The two Artist A clips are adjacent (not interleaved with Artist B's).
    const indices = artistABlock.map((id) => result.selectedIds.indexOf(id));
    expect(Math.abs(indices[0] - indices[1])).toBe(1);
  });

  it("grouped mode falls back to sourceId when artist metadata is absent", () => {
    const candidates = [
      candidate({ id: "s1-1", sourceId: "source-1" }),
      candidate({ id: "s1-2", sourceId: "source-1" }),
      candidate({ id: "s2-1", sourceId: "source-2" })
    ];
    const result = selectContentHeuristically({ candidates, mode: "grouped", targetCount: 3 });
    expect(result.selectedIds).toHaveLength(3);
  });

  it("doesn't penalize a candidate missing uploadDate metadata", () => {
    const candidates = [candidate({ id: "no-date", uploadDate: null })];
    const result = selectContentHeuristically({ candidates, mode: "balanced" });
    expect(result.selectedIds).toEqual(["no-date"]);
  });
});
