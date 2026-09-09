import { beforeEach, describe, expect, it, vi } from "vitest";
import { similarityScore } from "@/lib/metadata-lookup/http";

const mocks = vi.hoisted(() => ({
  mediaItem: { findUnique: vi.fn() },
  settings: vi.fn(),
  log: vi.fn(),
  applyMetadataCandidate: vi.fn(),
  musicbrainzSearch: vi.fn(),
  itunesSearch: vi.fn()
}));
vi.mock("@/lib/db/client", () => ({ db: { mediaItem: mocks.mediaItem } }));
vi.mock("@/lib/settings/service", () => ({ getSettings: mocks.settings }));
vi.mock("@/lib/logging/service", () => ({ writeLog: mocks.log }));
vi.mock("@/lib/media-items/service", () => ({ applyMetadataCandidate: mocks.applyMetadataCandidate }));
vi.mock("@/lib/metadata-lookup/musicbrainz", () => ({ musicBrainzProvider: { search: mocks.musicbrainzSearch } }));
vi.mock("@/lib/metadata-lookup/itunes", () => ({ itunesProvider: { search: mocks.itunesSearch } }));

const { searchMetadata, autoApplyMetadata } = await import("@/lib/metadata-lookup/service");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.log.mockResolvedValue(undefined);
  mocks.applyMetadataCandidate.mockResolvedValue(undefined);
  mocks.settings.mockResolvedValue({ metadataMusicbrainzEnabled: true, metadataItunesEnabled: true, metadataAutoApplyThreshold: 80 });
});

describe("similarityScore", () => {
  it("scores an exact token match at 100", () => expect(similarityScore("Some Artist Some Song", "Some Artist Some Song")).toBe(100));
  it("scores completely unrelated text near zero", () => expect(similarityScore("Some Artist Some Song", "Totally Different Thing")).toBe(0));
  it("is order-independent (an 'Artist Title' query matches a 'Title (feat. Artist)' result)", () => {
    expect(similarityScore("Some Artist Some Song", "Some Song (feat. Some Artist)")).toBeGreaterThanOrEqual(70);
  });
});

describe("searchMetadata", () => {
  it("merges and sorts candidates from both providers by score", async () => {
    mocks.musicbrainzSearch.mockResolvedValue([{ provider: "musicbrainz", externalId: "mb1", title: "A", score: 50 }]);
    mocks.itunesSearch.mockResolvedValue([{ provider: "itunes", externalId: "it1", title: "B", score: 90 }]);
    const results = await searchMetadata({ title: "Song" });
    expect(results.map((candidate) => candidate.provider)).toEqual(["itunes", "musicbrainz"]);
  });

  it("skips a disabled provider entirely", async () => {
    mocks.musicbrainzSearch.mockResolvedValue([{ provider: "musicbrainz", externalId: "mb1", title: "A", score: 50 }]);
    mocks.itunesSearch.mockResolvedValue([{ provider: "itunes", externalId: "it1", title: "B", score: 90 }]);
    const results = await searchMetadata({ title: "Song" }, undefined, { musicbrainz: true, itunes: false });
    expect(mocks.itunesSearch).not.toHaveBeenCalled();
    expect(results.map((candidate) => candidate.provider)).toEqual(["musicbrainz"]);
  });

  it("logs (rather than throws) when a provider rejects, and still returns the other's results", async () => {
    mocks.musicbrainzSearch.mockRejectedValue(new Error("MusicBrainz down"));
    mocks.itunesSearch.mockResolvedValue([{ provider: "itunes", externalId: "it1", title: "B", score: 90 }]);
    const results = await searchMetadata({ title: "Song" });
    expect(results).toHaveLength(1);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ level: "warn", message: expect.stringContaining("MusicBrainz") }));
  });
});

describe("autoApplyMetadata", () => {
  it("applies the top artist-bearing candidate once it clears the auto-apply threshold", async () => {
    mocks.mediaItem.findUnique.mockResolvedValue({ id: "m1", title: "Some Song", artist: null, metadataStatus: "pending" });
    mocks.musicbrainzSearch.mockResolvedValue([{ provider: "musicbrainz", externalId: "mb1", title: "Some Song", artist: "Some Artist", score: 90 }]);
    mocks.itunesSearch.mockResolvedValue([]);

    await autoApplyMetadata("m1");

    expect(mocks.applyMetadataCandidate).toHaveBeenCalledWith("m1", expect.objectContaining({ artist: "Some Artist", score: 90 }));
  });

  it("does not apply a candidate scoring below the threshold, and logs why instead", async () => {
    mocks.mediaItem.findUnique.mockResolvedValue({ id: "m1", title: "Some Song", artist: null, metadataStatus: "pending" });
    mocks.musicbrainzSearch.mockResolvedValue([{ provider: "musicbrainz", externalId: "mb1", title: "Some Song", artist: "Maybe Artist", score: 40 }]);
    mocks.itunesSearch.mockResolvedValue([]);

    await autoApplyMetadata("m1");

    expect(mocks.applyMetadataCandidate).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ mediaItemId: "m1", message: expect.stringContaining("No confident automatic metadata match") }));
  });

  it("skips items that already have an artist", async () => {
    mocks.mediaItem.findUnique.mockResolvedValue({ id: "m1", title: "Some Song", artist: "Already Set", metadataStatus: "pending" });

    await autoApplyMetadata("m1");

    expect(mocks.musicbrainzSearch).not.toHaveBeenCalled();
    expect(mocks.applyMetadataCandidate).not.toHaveBeenCalled();
  });

  it("never overrides an item the user already resolved manually", async () => {
    mocks.mediaItem.findUnique.mockResolvedValue({ id: "m1", title: "Some Song", artist: null, metadataStatus: "manual" });

    await autoApplyMetadata("m1");

    expect(mocks.musicbrainzSearch).not.toHaveBeenCalled();
    expect(mocks.applyMetadataCandidate).not.toHaveBeenCalled();
  });
});
