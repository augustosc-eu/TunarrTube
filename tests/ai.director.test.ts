import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { resolveAiProvider } from "@/lib/programming/provider";
import { buildDirectorCandidates, previewChannelSchedule } from "@/lib/programming/director";

// Same technique as tests/programming.test.ts: stub the provider-resolution layer so these tests
// exercise the Director's own candidate-gathering/preview-summarizing logic, not a real AI call.
vi.mock("@/lib/programming/provider", () => ({ resolveAiProvider: vi.fn() }));

const cleanupChannelIds: string[] = [];
const cleanupTemplateIds: string[] = [];
const cleanupMediaItemIds: string[] = [];
const cleanupDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await db.channel.deleteMany({ where: { id: { in: cleanupChannelIds.splice(0) } } });
  await db.overlayTemplate.deleteMany({ where: { id: { in: cleanupTemplateIds.splice(0) } } });
  await db.mediaItem.deleteMany({ where: { id: { in: cleanupMediaItemIds.splice(0) } } });
  await Promise.all(cleanupDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeChannelWithItems(items: Array<{ title: string; durationSeconds: number | null }>) {
  const template = await db.overlayTemplate.create({ data: { name: "Director Test Template", htmlTemplate: "<div>{{title}}</div>", bindingsJson: "[]", layersJson: "[]" } });
  cleanupTemplateIds.push(template.id);
  const suffix = `${Date.now()}-${Math.random()}`;
  const channel = await db.channel.create({
    data: { name: `Director Test ${suffix}`, slug: `director-test-${suffix}`, templateId: template.id, storageDirectory: `/tmp/ytarr-director-test-${suffix}` }
  });
  cleanupChannelIds.push(channel.id);
  cleanupDirs.push(channel.storageDirectory);
  let position = 0;
  const mediaItems = [];
  for (const item of items) {
    const mediaItem = await db.mediaItem.create({ data: { originType: "local", title: item.title, durationSeconds: item.durationSeconds } });
    cleanupMediaItemIds.push(mediaItem.id);
    await db.channelItem.create({ data: { channelId: channel.id, mediaItemId: mediaItem.id, position: position++ } });
    mediaItems.push(mediaItem);
  }
  return { channel, mediaItems };
}

describe("buildDirectorCandidates", () => {
  it("returns only items with a known positive duration", async () => {
    const { channel, mediaItems } = await makeChannelWithItems([
      { title: "Episode 1", durationSeconds: 300 },
      { title: "Unknown duration", durationSeconds: null },
      { title: "Zero duration", durationSeconds: 0 }
    ]);
    const candidates = await buildDirectorCandidates(channel.id);
    expect(candidates).toEqual([{ id: mediaItems[0].id, title: "Episode 1", artist: null, album: null, genre: null, durationMs: 300_000, uploadDate: null }]);
  });

  it("throws CHANNEL_NOT_FOUND for a missing channel", async () => {
    await expect(buildDirectorCandidates("nonexistent-channel-id")).rejects.toThrow(/Channel not found/);
  });
});

describe("previewChannelSchedule", () => {
  it("throws a clear error when the channel has no usable candidates", async () => {
    const { channel } = await makeChannelWithItems([{ title: "No duration", durationSeconds: null }]);
    await expect(previewChannelSchedule(channel.id, { instructions: "anything", scheduleStyle: "daily-dayparts", providerOverride: null }))
      .rejects.toThrow(/no items with a known duration/);
  });

  it("computes start/end times and resolves item titles for a dayparts plan", async () => {
    const { channel, mediaItems } = await makeChannelWithItems([
      { title: "Ep 1", durationSeconds: 600 },
      { title: "Ep 2", durationSeconds: 600 }
    ]);
    vi.mocked(resolveAiProvider).mockReturnValue({
      name: "claude-code",
      generatePlan: vi.fn(async () => ({
        kind: "dayparts", period: "day",
        blocks: [{ label: "Evening", startMinutes: 1080, itemIds: [mediaItems[0].id, mediaItems[1].id] }]
      })),
      selectContent: vi.fn()
    });

    const preview = await previewChannelSchedule(channel.id, { instructions: "evening block", scheduleStyle: "daily-dayparts", providerOverride: null });
    expect(preview.provider).toBe("claude-code");
    expect(preview.kind).toBe("dayparts");
    expect(preview.blocks).toHaveLength(1);
    // 1080 (18:00) + 20 minutes (2x600s clips) = 1100 (18:20).
    expect(preview.blocks![0]).toMatchObject({ label: "Evening", startMinutes: 1080, endMinutes: 1100 });
    expect(preview.blocks![0].items.map((item) => item.title)).toEqual(["Ep 1", "Ep 2"]);
    expect(preview.usedCandidateCount).toBe(2);
    expect(preview.unusedCandidateCount).toBe(0);
    expect(preview.warnings).toEqual([]);
  });

  it("warns about unused candidates and flags a filler mention in the instructions", async () => {
    const { channel, mediaItems } = await makeChannelWithItems([
      { title: "Ep 1", durationSeconds: 600 },
      { title: "Ep 2", durationSeconds: 600 }
    ]);
    vi.mocked(resolveAiProvider).mockReturnValue({
      name: "anthropic",
      generatePlan: vi.fn(async () => ({ kind: "dayparts", period: "day", blocks: [{ label: "Morning", startMinutes: 0, itemIds: [mediaItems[0].id] }] })),
      selectContent: vi.fn()
    });

    const preview = await previewChannelSchedule(channel.id, { instructions: "insert a 10-second filler after every episode", scheduleStyle: "daily-dayparts", providerOverride: null });
    expect(preview.unusedCandidateCount).toBe(1);
    expect(preview.warnings.some((warning) => warning.includes("1 of 2"))).toBe(true);
    expect(preview.warnings.some((warning) => warning.toLowerCase().includes("filler collection"))).toBe(true);
  });

  it("flags overlapping dayparts blocks as a warning", async () => {
    const { channel, mediaItems } = await makeChannelWithItems([
      { title: "Ep 1", durationSeconds: 3600 }, // 60 minutes -- long enough to run into the next block
      { title: "Ep 2", durationSeconds: 600 }
    ]);
    vi.mocked(resolveAiProvider).mockReturnValue({
      name: "anthropic",
      generatePlan: vi.fn(async () => ({
        kind: "dayparts", period: "day",
        blocks: [
          { label: "Morning", startMinutes: 0, itemIds: [mediaItems[0].id] },
          { label: "Midday", startMinutes: 30, itemIds: [mediaItems[1].id] }
        ]
      })),
      selectContent: vi.fn()
    });

    const preview = await previewChannelSchedule(channel.id, { instructions: "test", scheduleStyle: "daily-dayparts", providerOverride: null });
    expect(preview.warnings.some((warning) => warning.includes("runs past the start of"))).toBe(true);
  });

  it("produces a rotation preview with weight/cooldown, no start times", async () => {
    const { channel, mediaItems } = await makeChannelWithItems([{ title: "Ep 1", durationSeconds: 300 }]);
    vi.mocked(resolveAiProvider).mockReturnValue({
      name: "openai",
      generatePlan: vi.fn(async () => ({ kind: "rotation", groups: [{ label: "Hits", itemIds: [mediaItems[0].id], weight: 3, cooldownMinutes: 15 }] })),
      selectContent: vi.fn()
    });

    const preview = await previewChannelSchedule(channel.id, { instructions: "rotate", scheduleStyle: "endless-rotation", providerOverride: null });
    expect(preview.kind).toBe("rotation");
    expect(preview.blocks).toBeNull();
    expect(preview.groups).toEqual([{ label: "Hits", weight: 3, cooldownMinutes: 15, items: [{ id: mediaItems[0].id, title: "Ep 1", durationSeconds: 300 }] }]);
  });
});
