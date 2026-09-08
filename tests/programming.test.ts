import { afterEach, describe, expect, it, vi } from "vitest";
import { TunarrApiClient } from "@/lib/tunarr/client";
import { buildTunarrSchedule, buildTunarrRotationSchedule } from "@/lib/programming/schedule-builder";
import { programmingPlanSchema } from "@/lib/programming/plan-schema";
import { generateProgrammingPlan, ensureProgrammingPlan } from "@/lib/programming/ai-service";
import { resolveAiProvider } from "@/lib/programming/provider";
import type { ProgrammingCandidate, StoredProgrammingPlan } from "@/lib/programming/types";

vi.mock("@/lib/programming/provider", () => ({ resolveAiProvider: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const CANDIDATES: ProgrammingCandidate[] = [
  { id: "a", title: "Clip A", durationMs: 60_000 },
  { id: "b", title: "Clip B", durationMs: 30_000 }
];

// Stubs fetch to answer the schedule-time-slots/schedule-slots preview endpoints with a "healthy"
// materialized lineup that reaches every given Custom Show id at least once, plus createCustomShow.
function stubTunarrForSchedule(customShowIds: string[]) {
  const created: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/api/custom-shows") && init?.method === "POST") {
      created.push(JSON.parse(String(init.body)));
      return Response.json({ id: `custom-${created.length}` }, { status: 201 });
    }
    if (path.includes("/schedule-time-slots") || path.includes("/schedule-slots")) {
      return Response.json({ startTime: 1, lineup: customShowIds.map((id) => ({ type: "custom", duration: 1000, id: "prog", customShowId: id })) });
    }
    return Response.json({ message: "unexpected request" }, { status: 404 });
  }));
  return created;
}

describe("programmingPlanSchema", () => {
  it("accepts a well-formed dayparts plan", () => {
    expect(programmingPlanSchema.safeParse({ kind: "dayparts", period: "day", blocks: [{ label: "Morning", startMinutes: 0, itemIds: ["a"] }] }).success).toBe(true);
  });

  it("accepts a well-formed rotation plan", () => {
    expect(programmingPlanSchema.safeParse({ kind: "rotation", groups: [{ label: "Hits", itemIds: ["a"], weight: 2, cooldownMinutes: 15 }] }).success).toBe(true);
  });

  it("accepts a rotation group with cooldownMinutes omitted or null", () => {
    expect(programmingPlanSchema.safeParse({ kind: "rotation", groups: [{ label: "Hits", itemIds: ["a"], weight: 2 }] }).success).toBe(true);
    expect(programmingPlanSchema.safeParse({ kind: "rotation", groups: [{ label: "Hits", itemIds: ["a"], weight: 2, cooldownMinutes: null }] }).success).toBe(true);
  });

  it("rejects a dayparts block with no itemIds", () => {
    expect(programmingPlanSchema.safeParse({ kind: "dayparts", period: "day", blocks: [{ label: "Morning", startMinutes: 0, itemIds: [] }] }).success).toBe(false);
  });

  it("rejects an out-of-range startMinutes", () => {
    expect(programmingPlanSchema.safeParse({ kind: "dayparts", period: "day", blocks: [{ label: "Morning", startMinutes: -1, itemIds: ["a"] }] }).success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(programmingPlanSchema.safeParse({ kind: "shuffle", blocks: [] }).success).toBe(false);
  });
});

describe("generateProgrammingPlan", () => {
  it("drops item IDs the provider invented that aren't in the candidate list (dayparts)", async () => {
    vi.mocked(resolveAiProvider).mockReturnValue({
      name: "anthropic",
      generatePlan: vi.fn(async () => ({ kind: "dayparts", period: "day", blocks: [{ label: "Morning", startMinutes: 0, itemIds: ["a", "ghost"] }] })),
      selectContent: vi.fn()
    });
    const result = await generateProgrammingPlan({ candidates: CANDIDATES, instructions: null, kind: "dayparts", period: "day", providerOverride: null, globalProviderSetting: "auto" });
    expect(result.plan).toEqual({ kind: "dayparts", period: "day", blocks: [{ label: "Morning", startMinutes: 0, itemIds: ["a"] }] });
    expect(result.provider).toBe("anthropic");
  });

  it("drops item IDs the provider invented and defaults a missing cooldown (rotation)", async () => {
    vi.mocked(resolveAiProvider).mockReturnValue({
      name: "openai",
      generatePlan: vi.fn(async () => ({ kind: "rotation", groups: [{ label: "Hits", itemIds: ["a", "ghost"], weight: 2 }] })),
      selectContent: vi.fn()
    });
    const result = await generateProgrammingPlan({ candidates: CANDIDATES, instructions: null, kind: "rotation", period: "day", providerOverride: null, globalProviderSetting: "auto" });
    expect(result.plan).toEqual({ kind: "rotation", groups: [{ label: "Hits", itemIds: ["a"], weight: 2, cooldownMinutes: 30 }] });
  });

  it("rejects a response that fails schema validation entirely", async () => {
    vi.mocked(resolveAiProvider).mockReturnValue({ name: "anthropic", generatePlan: vi.fn(async () => ({ nonsense: true })), selectContent: vi.fn() });
    await expect(generateProgrammingPlan({ candidates: CANDIDATES, instructions: null, kind: "dayparts", period: "day", providerOverride: null, globalProviderSetting: "auto" })).rejects.toThrow(/schedule format/);
  });

  it("rejects a plan whose every block only referenced unknown IDs", async () => {
    vi.mocked(resolveAiProvider).mockReturnValue({
      name: "openai",
      generatePlan: vi.fn(async () => ({ kind: "dayparts", period: "day", blocks: [{ label: "Morning", startMinutes: 0, itemIds: ["ghost"] }] })),
      selectContent: vi.fn()
    });
    await expect(generateProgrammingPlan({ candidates: CANDIDATES, instructions: null, kind: "dayparts", period: "day", providerOverride: null, globalProviderSetting: "auto" })).rejects.toThrow(/did not reference/);
  });

  it("rejects a rotation plan whose every group only referenced unknown IDs", async () => {
    vi.mocked(resolveAiProvider).mockReturnValue({
      name: "openai",
      generatePlan: vi.fn(async () => ({ kind: "rotation", groups: [{ label: "Hits", itemIds: ["ghost"], weight: 1 }] })),
      selectContent: vi.fn()
    });
    await expect(generateProgrammingPlan({ candidates: CANDIDATES, instructions: null, kind: "rotation", period: "day", providerOverride: null, globalProviderSetting: "auto" })).rejects.toThrow(/did not reference/);
  });
});

describe("ensureProgrammingPlan", () => {
  it("reuses a cached plan when the candidate set, instructions, kind, and provider are unchanged", async () => {
    const generatePlan = vi.fn(async () => ({ kind: "dayparts", period: "day", blocks: [{ label: "Morning", startMinutes: 0, itemIds: ["a"] }] }));
    vi.mocked(resolveAiProvider).mockReturnValue({ name: "anthropic", generatePlan, selectContent: vi.fn() });
    const first = await generateProgrammingPlan({ candidates: CANDIDATES, instructions: null, kind: "dayparts", period: "day", providerOverride: null, globalProviderSetting: "auto" });
    const cached: StoredProgrammingPlan = first;

    generatePlan.mockClear();
    const result = await ensureProgrammingPlan({ cached, candidates: CANDIDATES, instructions: null, kind: "dayparts", period: "day", providerOverride: null, globalProviderSetting: "auto" });
    expect(result).toBe(cached);
    expect(generatePlan).not.toHaveBeenCalled();
  });

  it("regenerates when the schedule kind changed even if candidates/instructions did not", async () => {
    const generatePlan = vi.fn(async () => ({ kind: "rotation", groups: [{ label: "Hits", itemIds: ["a"], weight: 1 }] }));
    vi.mocked(resolveAiProvider).mockReturnValue({ name: "anthropic", generatePlan, selectContent: vi.fn() });
    const cached: StoredProgrammingPlan = {
      plan: { kind: "dayparts", period: "day", blocks: [{ label: "Morning", startMinutes: 0, itemIds: ["a"] }] },
      provider: "anthropic", instructions: null, candidatesSignature: "irrelevant-because-kind-changed", generatedAt: new Date().toISOString()
    };
    const result = await ensureProgrammingPlan({ cached, candidates: CANDIDATES, instructions: null, kind: "rotation", period: "day", providerOverride: null, globalProviderSetting: "auto" });
    expect(generatePlan).toHaveBeenCalledOnce();
    expect(result.plan.kind).toBe("rotation");
  });

  it("regenerates when instructions changed since the cached plan", async () => {
    const generatePlan = vi.fn(async () => ({ kind: "dayparts", period: "day", blocks: [{ label: "Evening", startMinutes: 600, itemIds: ["b"] }] }));
    vi.mocked(resolveAiProvider).mockReturnValue({ name: "anthropic", generatePlan, selectContent: vi.fn() });
    const cached: StoredProgrammingPlan = {
      plan: { kind: "dayparts", period: "day", blocks: [{ label: "Morning", startMinutes: 0, itemIds: ["a"] }] },
      provider: "anthropic", instructions: "old instructions", candidatesSignature: "stale", generatedAt: new Date().toISOString(),
      tunarr: { Morning: { customShowId: "cs-1", slotId: "slot-1" } }
    };
    const result = await ensureProgrammingPlan({ cached, candidates: CANDIDATES, instructions: "new instructions", kind: "dayparts", period: "day", providerOverride: null, globalProviderSetting: "auto" });
    expect(generatePlan).toHaveBeenCalledOnce();
    expect(result.plan.kind === "dayparts" && result.plan.blocks[0].label).toBe("Evening");
    // Previous Tunarr Custom Show/slot IDs carry forward so schedule-builder can still try to match by
    // label, even though the plan content itself changed.
    expect(result.tunarr).toEqual(cached.tunarr);
  });
});

describe("buildTunarrSchedule (dayparts)", () => {
  it("creates one Custom Show per block and a time schedule referencing them in start-time order", async () => {
    const created = stubTunarrForSchedule(["custom-1", "custom-2"]);
    const client = new TunarrApiClient("http://tunarr.test");
    const programIndex = new Map([
      ["a", { type: "content" as const, id: "prog-a", duration: 60_000 }],
      ["b", { type: "content" as const, id: "prog-b", duration: 30_000 }]
    ]);
    const plan = { kind: "dayparts" as const, period: "day" as const, blocks: [
      { label: "Evening", startMinutes: 720, itemIds: ["b"] },
      { label: "Morning", startMinutes: 0, itemIds: ["a"] }
    ] };
    const result = await buildTunarrSchedule({ client, plan, programIndex, namePrefix: "My Channel", previous: undefined, channelId: "chan-1" });
    expect(created).toEqual([
      { name: "My Channel — Evening", programs: [{ type: "content", id: "prog-b", duration: 30_000 }], syncMediaSourceId: null, syncMediaSourceType: null, syncExternalPlaylistId: null },
      { name: "My Channel — Morning", programs: [{ type: "content", id: "prog-a", duration: 60_000 }], syncMediaSourceId: null, syncMediaSourceType: null, syncExternalPlaylistId: null }
    ]);
    // Sorted by startTime regardless of the plan's own block order.
    expect(result.schedule.slots.map((slot) => slot.startTime)).toEqual([0, 720 * 60_000]);
    expect(result.programs).toEqual([]);
    // Regression guard: "distribute" divides a slot's leftover time by schedule.padMs inside Tunarr's
    // own scheduler (slotSchedulerUtil.ts:distributeFlex) -- with padMs: 0 that's a division by zero,
    // confirmed live against Tunarr 1.3.14 to silently corrupt the whole schedule (the time cursor stops
    // advancing) and then fail the publish with "NOT NULL constraint failed: channel.duration". Never
    // reintroduce "distribute" without also sending a real positive padMs.
    expect(result.schedule.flexPreference).toBe("end");
    expect(result.tunarr.Morning.customShowId).toBe("custom-2");
    expect(result.tunarr.Evening.customShowId).toBe("custom-1");
  });

  it("throws when none of the plan's clips were found in the scanned program index", async () => {
    stubTunarrForSchedule([]);
    const client = new TunarrApiClient("http://tunarr.test");
    const plan = { kind: "dayparts" as const, period: "day" as const, blocks: [{ label: "Missing", startMinutes: 0, itemIds: ["ghost"] }] };
    await expect(buildTunarrSchedule({ client, plan, programIndex: new Map(), namePrefix: "X", previous: undefined, channelId: "chan-1" })).rejects.toThrow(/scanned library/);
  });

  it("updates an existing Custom Show and reuses its slot ID instead of creating a duplicate", async () => {
    let putBody: unknown;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/api/custom-shows/existing-id") && init?.method === "PUT") {
        putBody = JSON.parse(String(init.body));
        return Response.json({}, { status: 200 });
      }
      if (path.includes("/schedule-time-slots")) {
        return Response.json({ startTime: 1, lineup: [{ type: "custom", duration: 1000, id: "prog", customShowId: "existing-id" }] });
      }
      return Response.json({ message: "unexpected request" }, { status: 404 });
    }));
    const client = new TunarrApiClient("http://tunarr.test");
    const programIndex = new Map([["a", { type: "content" as const, id: "prog-a", duration: 60_000 }]]);
    const plan = { kind: "dayparts" as const, period: "day" as const, blocks: [{ label: "Morning", startMinutes: 0, itemIds: ["a"] }] };
    const result = await buildTunarrSchedule({
      client, plan, programIndex, namePrefix: "X", channelId: "chan-1",
      previous: { Morning: { customShowId: "existing-id", slotId: "slot-1" } }
    });
    expect(putBody).toEqual({ name: "X — Morning", programs: [{ type: "content", id: "prog-a", duration: 60_000 }], enableSync: false });
    expect(result.schedule.slots[0].id).toBe("slot-1");
    expect(result.tunarr.Morning.customShowId).toBe("existing-id");
  });

  it("refuses to publish a schedule whose preview never reaches one of the scheduled blocks", async () => {
    // Simulates the exact live failure mode: the materialized preview only ever reaches "custom-1",
    // never "custom-2" -- schedule-builder.ts must refuse rather than publish it.
    stubTunarrForSchedule(["custom-1"]);
    const client = new TunarrApiClient("http://tunarr.test");
    const programIndex = new Map([
      ["a", { type: "content" as const, id: "prog-a", duration: 60_000 }],
      ["b", { type: "content" as const, id: "prog-b", duration: 30_000 }]
    ]);
    const plan = { kind: "dayparts" as const, period: "day" as const, blocks: [
      { label: "Morning", startMinutes: 0, itemIds: ["a"] },
      { label: "Evening", startMinutes: 720, itemIds: ["b"] }
    ] };
    await expect(buildTunarrSchedule({ client, plan, programIndex, namePrefix: "X", previous: undefined, channelId: "chan-1" })).rejects.toThrow(/never reached/);
  });

  it("refuses to publish a schedule whose preview contains a non-finite duration", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/api/custom-shows") && init?.method === "POST") return Response.json({ id: "custom-1" }, { status: 201 });
      if (path.includes("/schedule-time-slots")) {
        return Response.json({ startTime: 1, lineup: [{ type: "flex", duration: null }, { type: "custom", duration: 1000, id: "prog", customShowId: "custom-1" }] });
      }
      return Response.json({ message: "unexpected request" }, { status: 404 });
    }));
    const client = new TunarrApiClient("http://tunarr.test");
    const programIndex = new Map([["a", { type: "content" as const, id: "prog-a", duration: 60_000 }]]);
    const plan = { kind: "dayparts" as const, period: "day" as const, blocks: [{ label: "Morning", startMinutes: 0, itemIds: ["a"] }] };
    await expect(buildTunarrSchedule({ client, plan, programIndex, namePrefix: "X", previous: undefined, channelId: "chan-1" })).rejects.toThrow(/non-finite duration/);
  });
});

describe("buildTunarrRotationSchedule", () => {
  it("creates one Custom Show per group and a weighted random schedule with per-group cooldowns", async () => {
    const created = stubTunarrForSchedule(["custom-1", "custom-2"]);
    const client = new TunarrApiClient("http://tunarr.test");
    const programIndex = new Map([
      ["a", { type: "content" as const, id: "prog-a", duration: 60_000 }],
      ["b", { type: "content" as const, id: "prog-b", duration: 30_000 }]
    ]);
    const plan = { kind: "rotation" as const, groups: [
      { label: "Hits", itemIds: ["a"], weight: 3, cooldownMinutes: 10 },
      { label: "Deep Cuts", itemIds: ["b"], weight: 1, cooldownMinutes: 60 }
    ] };
    const result = await buildTunarrRotationSchedule({ client, plan, programIndex, namePrefix: "My Channel", previous: undefined, channelId: "chan-1" });
    expect(created).toHaveLength(2);
    expect(result.schedule.type).toBe("random");
    expect(result.schedule.randomDistribution).toBe("weighted");
    expect(result.schedule.flexPreference).toBe("end");
    const hits = result.schedule.slots.find((slot) => slot.customShowId === result.tunarr.Hits.customShowId)!;
    expect(hits.weight).toBe(3);
    expect(hits.cooldownMs).toBe(10 * 60_000);
    const deepCuts = result.schedule.slots.find((slot) => slot.customShowId === result.tunarr["Deep Cuts"].customShowId)!;
    expect(deepCuts.weight).toBe(1);
    expect(deepCuts.cooldownMs).toBe(60 * 60_000);
  });

  it("does not require every group to appear in the preview window (unlike dayparts)", async () => {
    // A weighted/cooldown rotation legitimately might not pick a rare group within a short preview
    // window -- only the non-finite-duration check applies to rotation, never the "reached every
    // slot" one.
    stubTunarrForSchedule(["custom-1"]); // "Deep Cuts" (custom-2) never appears in the preview
    const client = new TunarrApiClient("http://tunarr.test");
    const programIndex = new Map([
      ["a", { type: "content" as const, id: "prog-a", duration: 60_000 }],
      ["b", { type: "content" as const, id: "prog-b", duration: 30_000 }]
    ]);
    const plan = { kind: "rotation" as const, groups: [
      { label: "Hits", itemIds: ["a"], weight: 10, cooldownMinutes: 5 },
      { label: "Deep Cuts", itemIds: ["b"], weight: 1, cooldownMinutes: 600 }
    ] };
    await expect(buildTunarrRotationSchedule({ client, plan, programIndex, namePrefix: "X", previous: undefined, channelId: "chan-1" })).resolves.toBeTruthy();
  });

  it("still refuses a rotation schedule whose preview contains a non-finite duration", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/api/custom-shows") && init?.method === "POST") return Response.json({ id: "custom-1" }, { status: 201 });
      if (path.includes("/schedule-slots")) {
        return Response.json({ startTime: 1, lineup: [{ type: "flex", duration: null }] });
      }
      return Response.json({ message: "unexpected request" }, { status: 404 });
    }));
    const client = new TunarrApiClient("http://tunarr.test");
    const programIndex = new Map([["a", { type: "content" as const, id: "prog-a", duration: 60_000 }]]);
    const plan = { kind: "rotation" as const, groups: [{ label: "Hits", itemIds: ["a"], weight: 1, cooldownMinutes: 5 }] };
    await expect(buildTunarrRotationSchedule({ client, plan, programIndex, namePrefix: "X", previous: undefined, channelId: "chan-1" })).rejects.toThrow(/non-finite duration/);
  });
});
