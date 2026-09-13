import { afterEach, describe, expect, it, vi } from "vitest";
import { contentSelectionSchema } from "@/lib/programming/selection-schema";
import { selectContent } from "@/lib/programming/content-selection";
import { resolveAiProvider } from "@/lib/programming/provider";
import type { SelectionCandidate } from "@/lib/programming/providers/types";

vi.mock("@/lib/programming/provider", () => ({ resolveAiProvider: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const CANDIDATES: SelectionCandidate[] = [
  { id: "sv-1", title: "Clip A", durationMs: 60_000, sourceName: "My Source" },
  { id: "sv-2", title: "Clip B", durationMs: 30_000, sourceName: "My Source" }
];

describe("contentSelectionSchema", () => {
  it("accepts a well-formed selection", () => {
    expect(contentSelectionSchema.safeParse({ selectedIds: ["a", "b"] }).success).toBe(true);
  });

  it("rejects an empty selection", () => {
    expect(contentSelectionSchema.safeParse({ selectedIds: [] }).success).toBe(false);
  });
});

describe("selectContent", () => {
  it("throws when there are no candidates to choose from", async () => {
    await expect(selectContent({ candidates: [], instructions: "anything", providerOverride: null, globalProviderSetting: "auto" })).rejects.toThrow(/nothing to select/);
  });

  it("drops selected IDs the provider invented that aren't in the candidate list", async () => {
    vi.mocked(resolveAiProvider).mockReturnValue({
      name: "anthropic",
      generatePlan: vi.fn(),
      selectContent: vi.fn(async () => ({ selectedIds: ["sv-1", "ghost"] }))
    });
    const result = await selectContent({ candidates: CANDIDATES, instructions: "upbeat only", providerOverride: null, globalProviderSetting: "auto" });
    expect(result.selectedIds).toEqual(["sv-1"]);
    expect(result.provider).toBe("anthropic");
  });

  it("rejects a response that fails schema validation entirely", async () => {
    vi.mocked(resolveAiProvider).mockReturnValue({ name: "anthropic", generatePlan: vi.fn(), selectContent: vi.fn(async () => ({ nonsense: true })) });
    await expect(selectContent({ candidates: CANDIDATES, instructions: "x", providerOverride: null, globalProviderSetting: "auto" })).rejects.toThrow(/expected format/);
  });

  it("rejects a selection that only referenced unknown IDs", async () => {
    vi.mocked(resolveAiProvider).mockReturnValue({ name: "openai", generatePlan: vi.fn(), selectContent: vi.fn(async () => ({ selectedIds: ["ghost"] })) });
    await expect(selectContent({ candidates: CANDIDATES, instructions: "x", providerOverride: null, globalProviderSetting: "auto" })).rejects.toThrow(/did not select/);
  });

  it("passes the target count and instructions through to the provider", async () => {
    const selectContentMock = vi.fn(async () => ({ selectedIds: ["sv-1"] }));
    vi.mocked(resolveAiProvider).mockReturnValue({ name: "anthropic", generatePlan: vi.fn(), selectContent: selectContentMock });
    await selectContent({ candidates: CANDIDATES, instructions: "only upbeat clips", targetCount: 5, providerOverride: null, globalProviderSetting: "auto" });
    expect(selectContentMock).toHaveBeenCalledWith(
      { candidates: CANDIDATES, instructions: "only upbeat clips", targetCount: 5 },
      undefined
    );
  });
});
