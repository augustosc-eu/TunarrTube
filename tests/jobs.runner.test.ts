import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { markJobCancelled, recoverJobs } from "@/lib/jobs/runner";

describe("recoverJobs (startup recovery)", () => {
  const cleanupVideoIds: string[] = [];

  afterEach(async () => {
    await db.video.deleteMany({ where: { id: { in: cleanupVideoIds.splice(0) } } });
    delete (globalThis as Record<string, unknown>).tunarrtubeRecovered;
  });

  it("zeroes out a CacheAsset's activeReaders left stuck above zero by a crash", async () => {
    // activeReaders is incremented in-process for the duration of a playback stream
    // (lib/playback/service.ts) and only decremented via that stream's close/error/end handlers -- a
    // restart while a client had a cached file open would otherwise leave it stuck forever, since a
    // fresh process has no live stream to eventually balance it and nothing else ever resets it. That
    // then permanently blocks the asset from cache eviction (lib/cache/service.ts reads it as "still
    // playing"), with no route that can force an eviction past it either.
    const video = await db.video.create({
      data: { youtubeId: `runner-test-${Date.now()}`, title: "Runner test video", youtubeUrl: "https://www.youtube.com/watch?v=runner-test" }
    });
    cleanupVideoIds.push(video.id);
    const asset = await db.cacheAsset.create({ data: { videoId: video.id, status: "complete", activeReaders: 2 } });

    delete (globalThis as Record<string, unknown>).tunarrtubeRecovered;
    await recoverJobs();

    const reloaded = await db.cacheAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.activeReaders).toBe(0);
  });

  it("only runs once per process", async () => {
    delete (globalThis as Record<string, unknown>).tunarrtubeRecovered;
    const video = await db.video.create({
      data: { youtubeId: `runner-test-once-${Date.now()}`, title: "Runner test video", youtubeUrl: "https://www.youtube.com/watch?v=runner-test-once" }
    });
    cleanupVideoIds.push(video.id);
    const asset = await db.cacheAsset.create({ data: { videoId: video.id, status: "complete", activeReaders: 1 } });

    await recoverJobs();
    // Simulate a reader that started after the first (real) recovery pass -- a second call within the
    // same process must not zero it out again.
    await db.cacheAsset.update({ where: { id: asset.id }, data: { activeReaders: 1 } });
    await recoverJobs();

    const reloaded = await db.cacheAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.activeReaders).toBe(1);
  });
});

describe("markJobCancelled", () => {
  const cleanup: { sourceIds: string[]; videoIds: string[] } = { sourceIds: [], videoIds: [] };

  afterEach(async () => {
    await db.job.deleteMany({ where: { sourceId: { in: cleanup.sourceIds } } });
    await db.source.deleteMany({ where: { id: { in: cleanup.sourceIds.splice(0) } } });
    await db.job.deleteMany({ where: { videoId: { in: cleanup.videoIds } } });
    await db.video.deleteMany({ where: { id: { in: cleanup.videoIds.splice(0) } } });
  });

  async function fixture(downloadStatus: string, cacheStatus: string) {
    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({ data: { name: "Stop race", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `stop-${suffix}`, mediaDirectory: `/tmp/stop-${suffix}` } });
    const video = await db.video.create({ data: { youtubeId: `stop-${suffix}`, title: "Stop race video", youtubeUrl: `https://www.youtube.com/watch?v=stop-${suffix}` } });
    cleanup.sourceIds.push(source.id);
    cleanup.videoIds.push(video.id);
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id, downloadStatus } });
    await db.cacheAsset.create({ data: { videoId: video.id, status: cacheStatus } });
    return { source, video };
  }

  // Issue #32: Stop can arrive after downloadVideo()/cacheVideo() has already put the file in place.
  it.each(["download", "cache"])("leaves a %s that already completed recorded as complete", async (type) => {
    const { source, video } = await fixture("complete", "complete");
    const job = await db.job.create({ data: { type, status: "running", sourceId: source.id, videoId: video.id } });

    expect(await markJobCancelled(job, "Stopped by user.")).toBe(true);

    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("cancelled");
    expect((await db.sourceVideo.findFirstOrThrow({ where: { sourceId: source.id, videoId: video.id } })).downloadStatus).toBe("complete");
    expect((await db.cacheAsset.findFirstOrThrow({ where: { videoId: video.id } })).status).toBe("complete");
  });

  it("still marks an in-progress download and cache as cancelled", async () => {
    const { source, video } = await fixture("downloading", "downloading");
    for (const type of ["download", "cache"]) {
      const job = await db.job.create({ data: { type, status: "running", sourceId: source.id, videoId: video.id } });
      await markJobCancelled(job, "Stopped by user.");
    }
    expect((await db.sourceVideo.findFirstOrThrow({ where: { sourceId: source.id, videoId: video.id } })).downloadStatus).toBe("cancelled");
    expect((await db.cacheAsset.findFirstOrThrow({ where: { videoId: video.id } })).status).toBe("cancelled");
  });
});
