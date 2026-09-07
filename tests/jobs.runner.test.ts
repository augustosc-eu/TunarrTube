import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { recoverJobs } from "@/lib/jobs/runner";

describe("recoverJobs (startup recovery)", () => {
  const cleanupVideoIds: string[] = [];

  afterEach(async () => {
    await db.video.deleteMany({ where: { id: { in: cleanupVideoIds.splice(0) } } });
    delete (globalThis as Record<string, unknown>).ytarrRecovered;
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

    delete (globalThis as Record<string, unknown>).ytarrRecovered;
    await recoverJobs();

    const reloaded = await db.cacheAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reloaded.activeReaders).toBe(0);
  });

  it("only runs once per process", async () => {
    delete (globalThis as Record<string, unknown>).ytarrRecovered;
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
