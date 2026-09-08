import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";

// Same rationale as tests/channels.service.test.ts: the real job queue (kickWorker's table-wide claim
// loop) is exactly the shared-DB race that suite avoids, so it's stubbed out the same way.
vi.mock("@/lib/jobs/runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jobs/runner")>();
  return { ...actual, kickWorker: vi.fn() };
});

// runChannelBrief's render/publish steps are real ffmpeg/Puppeteer and a real Tunarr HTTP call
// respectively -- neither is what this test is exercising (that's covered by tests/renders.service
// .test.ts and tests/tunarr-channel.integration.test.ts). Stub both so this test only checks
// runChannelBrief's own orchestration: select (once) -> render every selected item -> publish.
const renderMediaItem = vi.fn(async (mediaItemId: string) => ({ id: `render-${mediaItemId}`, status: "complete" }));
vi.mock("@/lib/renders/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/renders/service")>();
  return { ...actual, renderMediaItem };
});
const publishChannelToTunarr = vi.fn(async () => ({ channelId: "tunarr-channel", channelNumber: 1, programCount: 1, mediaSourceId: "m", libraryId: "l", publishedAt: new Date() }));
vi.mock("@/lib/tunarr/channel-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tunarr/channel-service")>();
  return { ...actual, publishChannelToTunarr };
});

// Content selection's AI call goes through the same provider resolution as programming plans --
// mocked so this test never makes a real Anthropic/OpenAI call.
vi.mock("@/lib/programming/provider", () => ({ resolveAiProvider: vi.fn() }));

const { createChannel, createChannelFromBrief, runChannelBrief } = await import("@/lib/channels/service");
const { resolveAiProvider } = await import("@/lib/programming/provider");

const cleanupChannelIds: string[] = [];
const cleanupTemplateIds: string[] = [];
const cleanupSourceIds: string[] = [];
const cleanupVideoIds: string[] = [];
const cleanupDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await db.channel.deleteMany({ where: { id: { in: cleanupChannelIds.splice(0) } } });
  await db.overlayTemplate.deleteMany({ where: { id: { in: cleanupTemplateIds.splice(0) } } });
  await db.source.deleteMany({ where: { id: { in: cleanupSourceIds.splice(0) } } });
  await db.video.deleteMany({ where: { id: { in: cleanupVideoIds.splice(0) } } });
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeTemplate() {
  const template = await db.overlayTemplate.create({
    data: { name: "Test Template", htmlTemplate: "<div>{{title}}</div>", bindingsJson: "[]", layersJson: "[]" }
  });
  cleanupTemplateIds.push(template.id);
  return template;
}

async function makeDownloadedSourceVideo() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const source = await db.source.create({
    data: { name: "Brief test source", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `brief-test-${suffix}`, mediaDirectory: `/tmp/ytarr-brief-test-${suffix}` }
  });
  const video = await db.video.create({
    data: { youtubeId: `video-${suffix}`, title: "Brief test video", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}`, durationSeconds: 180 }
  });
  const sourceVideo = await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id, downloadStatus: "complete", localPath: `/tmp/ytarr-brief-test-${suffix}/${video.youtubeId}.mp4` } });
  cleanupSourceIds.push(source.id);
  cleanupVideoIds.push(video.id);
  return { source, video, sourceVideo };
}

describe("createChannelFromBrief", () => {
  it("creates the channel with AI programming fields set from the brief and queues a channel_brief job", async () => {
    const template = await makeTemplate();
    const { source } = await makeDownloadedSourceVideo();
    const result = await createChannelFromBrief({
      name: "Brief Channel", templateId: template.id, brief: "late-night chill vibes",
      sourceIds: [source.id], scheduleStyle: "endless-rotation"
    });
    cleanupChannelIds.push(result.channel.id);
    cleanupDirs.push(result.channel.storageDirectory);

    const stored = await db.channel.findUniqueOrThrow({ where: { id: result.channel.id } });
    expect(stored.programmingOrder).toBe("ai");
    expect(stored.aiScheduleStyle).toBe("endless-rotation");
    expect(stored.aiProgrammingInstructions).toBe("late-night chill vibes");

    const job = await db.job.findUniqueOrThrow({ where: { id: result.jobId } });
    expect(job.type).toBe("channel_brief");
    expect(JSON.parse(job.payloadJson!)).toEqual({ sourceIds: [source.id] });
  });
});

describe("runChannelBrief", () => {
  it("selects content, renders every selected item once, and publishes -- in that order", async () => {
    const template = await makeTemplate();
    const channel = await createChannel({ name: `Brief Run ${Date.now()}`, templateId: template.id });
    cleanupChannelIds.push(channel.id);
    cleanupDirs.push(channel.storageDirectory);
    await db.channel.update({ where: { id: channel.id }, data: { aiProgrammingInstructions: "chill only" } });
    const { source, sourceVideo } = await makeDownloadedSourceVideo();

    vi.mocked(resolveAiProvider).mockReturnValue({
      name: "anthropic",
      generatePlan: vi.fn(),
      selectContent: vi.fn(async () => ({ selectedIds: [sourceVideo.id] }))
    });

    await runChannelBrief(channel.id, { sourceIds: [source.id] });

    const items = await db.channelItem.findMany({ where: { channelId: channel.id } });
    expect(items).toHaveLength(1);
    expect(renderMediaItem).toHaveBeenCalledTimes(1);
    expect(renderMediaItem).toHaveBeenCalledWith(items[0].mediaItemId, template.id, undefined);
    expect(publishChannelToTunarr).toHaveBeenCalledTimes(1);
    expect(publishChannelToTunarr).toHaveBeenCalledWith(channel.id, undefined);
  });

  it("skips content selection on a retry once the channel already has items", async () => {
    const template = await makeTemplate();
    const channel = await createChannel({ name: `Brief Retry ${Date.now()}`, templateId: template.id });
    cleanupChannelIds.push(channel.id);
    cleanupDirs.push(channel.storageDirectory);
    const { source, sourceVideo } = await makeDownloadedSourceVideo();

    const selectContentMock = vi.fn(async () => ({ selectedIds: [sourceVideo.id] }));
    vi.mocked(resolveAiProvider).mockReturnValue({ name: "anthropic", generatePlan: vi.fn(), selectContent: selectContentMock });

    await runChannelBrief(channel.id, { sourceIds: [source.id] });
    expect(selectContentMock).toHaveBeenCalledTimes(1);

    // Simulate a retry after render failed on the first attempt -- content selection (a real, billed
    // AI call) must not run again now that the channel already has items.
    await runChannelBrief(channel.id, { sourceIds: [source.id] });
    expect(selectContentMock).toHaveBeenCalledTimes(1);
    expect(renderMediaItem).toHaveBeenCalledTimes(2);
  });
});
