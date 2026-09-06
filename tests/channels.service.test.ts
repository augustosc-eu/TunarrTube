import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";

// Same rationale as tests/jobs.service.test.ts: addYoutubeUrlToChannel's real job is exercised here
// via the real, unmodified addVideosToCollection() -- but the *actual* background download draining
// the resulting job queue (kickWorker's table-wide claim loop) is exactly the shared-DB race that
// suite avoids, so it's stubbed out the same way.
vi.mock("@/lib/jobs/runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jobs/runner")>();
  return { ...actual, kickWorker: vi.fn() };
});

const { attachExistingVideo, addYoutubeUrlToChannel, createChannel, enqueueChannelJob } = await import("@/lib/channels/service");

const cleanupChannelIds: string[] = [];
const cleanupTemplateIds: string[] = [];
const cleanupSourceIds: string[] = [];
const cleanupVideoIds: string[] = [];
const cleanupJobIds: string[] = [];
const cleanupDirs: string[] = [];

afterEach(async () => {
  delete process.env.YTARR_YTDLP_PATH;
  await db.channel.deleteMany({ where: { id: { in: cleanupChannelIds.splice(0) } } });
  await db.overlayTemplate.deleteMany({ where: { id: { in: cleanupTemplateIds.splice(0) } } });
  await db.source.deleteMany({ where: { id: { in: cleanupSourceIds.splice(0) } } });
  await db.video.deleteMany({ where: { id: { in: cleanupVideoIds.splice(0) } } });
  await db.job.deleteMany({ where: { id: { in: cleanupJobIds.splice(0) } } });
  await Promise.all(cleanupDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

// YouTube video IDs must be exactly 11 chars ([A-Za-z0-9_-]) -- lib/youtube/url.ts's regex rejects
// anything else, so test URLs need a deterministic-but-unique 11-char id rather than a raw timestamp.
function makeVideoId(seed: number) {
  return `v${seed.toString(36)}00000000`.slice(0, 11);
}

async function makeTemplate() {
  const template = await db.overlayTemplate.create({
    data: { name: "Test Template", htmlTemplate: "<div>{{title}}</div>", bindingsJson: "[]", layersJson: "[]" }
  });
  cleanupTemplateIds.push(template.id);
  return template;
}

async function makeChannel() {
  const template = await makeTemplate();
  const channel = await createChannel({ name: `Test Channel ${Date.now()}-${Math.random()}`, templateId: template.id });
  cleanupChannelIds.push(channel.id);
  cleanupDirs.push(channel.storageDirectory);
  return channel;
}

async function makeDownloadedSourceVideo() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const source = await db.source.create({
    data: { name: "Attach test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `attach-test-${suffix}`, mediaDirectory: `/tmp/ytarr-attach-test-${suffix}` }
  });
  const video = await db.video.create({
    data: { youtubeId: `video-${suffix}`, title: "Attach test video", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}`, durationSeconds: 180 }
  });
  const sourceVideo = await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id, downloadStatus: "complete", localPath: `/tmp/ytarr-attach-test-${suffix}/${video.youtubeId}.mp4` } });
  cleanupSourceIds.push(source.id);
  cleanupVideoIds.push(video.id);
  return sourceVideo;
}

describe("attachExistingVideo", () => {
  it("wraps an already-downloaded SourceVideo as a MediaItem and adds it to the channel", async () => {
    const channel = await makeChannel();
    const sourceVideo = await db.sourceVideo.findUniqueOrThrow({ where: { id: (await makeDownloadedSourceVideo()).id }, include: { video: true } });

    const mediaItem = await attachExistingVideo(channel.id, sourceVideo.id);
    expect(mediaItem).toMatchObject({ originType: "sourceVideo", sourceVideoId: sourceVideo.id, title: sourceVideo.video.title });

    const items = await db.channelItem.findMany({ where: { channelId: channel.id } });
    expect(items.map((item) => item.mediaItemId)).toEqual([mediaItem.id]);
  });

  it("is idempotent: attaching the same SourceVideo twice reuses the same MediaItem row", async () => {
    const channel = await makeChannel();
    const sourceVideo = await makeDownloadedSourceVideo();

    const first = await attachExistingVideo(channel.id, sourceVideo.id);
    const second = await attachExistingVideo(channel.id, sourceVideo.id);
    expect(second.id).toBe(first.id);

    const items = await db.channelItem.findMany({ where: { channelId: channel.id } });
    expect(items).toHaveLength(1);
  });

  it("lets the same clip be shared across two different channels via separate ChannelItem rows", async () => {
    const channelA = await makeChannel();
    const channelB = await makeChannel();
    const sourceVideo = await makeDownloadedSourceVideo();

    const itemA = await attachExistingVideo(channelA.id, sourceVideo.id);
    const itemB = await attachExistingVideo(channelB.id, sourceVideo.id);
    expect(itemB.id).toBe(itemA.id);

    expect(await db.channelItem.count({ where: { channelId: channelA.id } })).toBe(1);
    expect(await db.channelItem.count({ where: { channelId: channelB.id } })).toBe(1);
  });
});

describe("addYoutubeUrlToChannel", () => {
  it("creates a companion collection Source (visible like any other) and attaches the downloaded video", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-channel-intake-test-"));
    cleanupDirs.push(root);
    const fakeYtDlp = path.join(root, "yt-dlp");
    const videoId = makeVideoId(Date.now());
    await writeFile(fakeYtDlp, `#!/usr/bin/env node
console.log(JSON.stringify({ id: "${videoId}", title: "Fake Channel Video", duration: 210, uploader: "Fake Uploader" }));
`);
    await chmod(fakeYtDlp, 0o755);
    process.env.YTARR_YTDLP_PATH = fakeYtDlp;

    const channel = await makeChannel();
    const result = await addYoutubeUrlToChannel(channel.id, `https://www.youtube.com/watch?v=${videoId}`);
    expect(result.addedCount).toBe(1);
    expect(result.mediaItems).toHaveLength(1);
    expect(result.mediaItems[0]).toMatchObject({ originType: "sourceVideo", title: "Fake Channel Video" });

    const refreshedChannel = await db.channel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(refreshedChannel.intakeSourceId).toBeTruthy();
    const intake = await db.source.findUniqueOrThrow({ where: { id: refreshedChannel.intakeSourceId! } });
    expect(intake.sourceType).toBe("collection");
    cleanupSourceIds.push(intake.id);
    cleanupDirs.push(intake.mediaDirectory);

    const video = await db.video.findUniqueOrThrow({ where: { youtubeId: videoId } });
    cleanupVideoIds.push(video.id);
    const membership = await db.sourceVideo.findUniqueOrThrow({ where: { sourceId_videoId: { sourceId: intake.id, videoId: video.id } } });
    expect(membership.membershipStatus).toBe("present");

    const downloadJobs = await db.job.findMany({ where: { sourceId: intake.id, type: "download" } });
    cleanupJobIds.push(...downloadJobs.map((job) => job.id));
    expect(downloadJobs).toHaveLength(1);
  });

  it("reuses the same companion Source across repeated calls instead of creating a new one each time", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-channel-intake-test-"));
    cleanupDirs.push(root);
    const fakeYtDlp = path.join(root, "yt-dlp");
    await writeFile(fakeYtDlp, `#!/usr/bin/env node
const args = process.argv;
console.log(JSON.stringify({ id: args[args.length - 1].split("v=")[1], title: "Fake Video " + Date.now() + Math.random(), duration: 100 }));
`);
    await chmod(fakeYtDlp, 0o755);
    process.env.YTARR_YTDLP_PATH = fakeYtDlp;

    const channel = await makeChannel();
    const seed = Date.now();
    await addYoutubeUrlToChannel(channel.id, `https://www.youtube.com/watch?v=${makeVideoId(seed)}`);
    const afterFirst = await db.channel.findUniqueOrThrow({ where: { id: channel.id } });
    await addYoutubeUrlToChannel(channel.id, `https://www.youtube.com/watch?v=${makeVideoId(seed + 1)}`);
    const afterSecond = await db.channel.findUniqueOrThrow({ where: { id: channel.id } });

    expect(afterSecond.intakeSourceId).toBe(afterFirst.intakeSourceId);
    const intake = await db.source.findUniqueOrThrow({ where: { id: afterFirst.intakeSourceId! } });
    cleanupSourceIds.push(intake.id);
    cleanupDirs.push(intake.mediaDirectory);
    const videos = await db.video.findMany({ where: { sources: { some: { sourceId: intake.id } } } });
    cleanupVideoIds.push(...videos.map((video) => video.id));
    const jobs = await db.job.findMany({ where: { sourceId: intake.id } });
    cleanupJobIds.push(...jobs.map((job) => job.id));
    expect(videos).toHaveLength(2);
  });
});

describe("enqueueChannelJob", () => {
  it("returns the existing queued job instead of creating a duplicate for the same target", async () => {
    const channel = await makeChannel();
    const first = await enqueueChannelJob("channel_publish", { channelId: channel.id });
    cleanupJobIds.push(first.id);
    const second = await enqueueChannelJob("channel_publish", { channelId: channel.id });
    expect(second.id).toBe(first.id);
    expect(await db.job.count({ where: { channelId: channel.id, type: "channel_publish" } })).toBe(1);
  });

  it("creates a fresh job once the previous one has finished", async () => {
    const channel = await makeChannel();
    const first = await enqueueChannelJob("channel_publish", { channelId: channel.id });
    await db.job.update({ where: { id: first.id }, data: { status: "complete", finishedAt: new Date() } });
    const second = await enqueueChannelJob("channel_publish", { channelId: channel.id });
    cleanupJobIds.push(first.id, second.id);
    expect(second.id).not.toBe(first.id);
  });
});
