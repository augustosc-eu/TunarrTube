import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { VideoUnavailableError } from "@/lib/downloads/service";
import { handleJobFailure } from "@/lib/jobs/runner";

// Exercises handleJobFailure() directly rather than through claimJob()/kickWorker(): that drain loop scans
// the whole Job table with no per-test scoping, so driving it from a test would risk racing a *different*
// test file's own kickWorker() call (e.g. one triggered by lib/sources/service.ts) over the same shared
// dev database. Calling the extracted failure handler directly tests the same logic deterministically.
describe("download queue rate-limit handling", () => {
  const cleanupJobIds: string[] = [];

  afterEach(async () => {
    await db.job.deleteMany({ where: { id: { in: cleanupJobIds.splice(0) } } });
  });

  it("backs off for minutes (counting the attempt, without pausing other jobs) when YouTube's CDN drops the connection", async () => {
    const jobA = await db.job.create({ data: { type: "download", attempts: 1, status: "running" } });
    const jobB = await db.job.create({ data: { type: "download", attempts: 0, status: "queued" } });
    cleanupJobIds.push(jobA.id, jobB.id);

    const before = Date.now();
    await handleJobFailure(jobA, new Error("yt-dlp failed: ERROR: [download] Got error: ('Connection aborted.', RemoteDisconnected('Remote end closed connection without response')). Giving up after 10 retries"));

    const [refreshedA, refreshedB] = await Promise.all([
      db.job.findUniqueOrThrow({ where: { id: jobA.id } }),
      db.job.findUniqueOrThrow({ where: { id: jobB.id } })
    ]);

    // Still counted (bounded retries), but delayed ~5 minutes rather than the ordinary 4s.
    expect(refreshedA.status).toBe("queued");
    expect(refreshedA.attempts).toBe(1);
    expect(refreshedA.runAfter.getTime()).toBeGreaterThanOrEqual(before + 290_000);
    // Unlike a 429, the rest of the queue is left alone.
    expect(refreshedB.runAfter.getTime()).toBeLessThan(before + 60_000);
  });

  it("pauses every queued download job (not just the failing one) on a YouTube 429, without burning an attempt", async () => {
    // attempts: 1 simulates the state right after claimJob()'s atomic increment on the job that's about
    // to fail; jobB simulates a second, not-yet-claimed download job still waiting in the queue.
    const jobA = await db.job.create({ data: { type: "download", attempts: 1, status: "running" } });
    const jobB = await db.job.create({ data: { type: "download", attempts: 0, status: "queued" } });
    cleanupJobIds.push(jobA.id, jobB.id);

    const before = Date.now();
    await handleJobFailure(jobA, new Error("yt-dlp failed: ERROR: unable to download video data: HTTP Error 429: Too Many Requests"));

    const [refreshedA, refreshedB] = await Promise.all([
      db.job.findUniqueOrThrow({ where: { id: jobA.id } }),
      db.job.findUniqueOrThrow({ where: { id: jobB.id } })
    ]);

    // Not marked "failed", and the failed attempt wasn't counted against maxAttempts: a 429 is YouTube
    // throttling us, not this video being broken, so it should be retried indefinitely rather than
    // burning through the job's 3 attempts.
    expect(refreshedA.status).toBe("queued");
    expect(refreshedA.attempts).toBe(0);
    expect(refreshedA.error).toContain("429");

    // The other queued download job gets pushed out to the same cooldown, even though it never failed.
    expect(refreshedB.status).toBe("queued");
    expect(refreshedB.attempts).toBe(0);

    // The cooldown is a real pause (well beyond the ~2-60s per-job backoff used for ordinary failures),
    // and both jobs land at (about) the same cooldown deadline.
    const secondsUntilA = (refreshedA.runAfter.getTime() - before) / 1000;
    expect(secondsUntilA).toBeGreaterThan(90);
    expect(secondsUntilA).toBeLessThan(1900);
    expect(Math.abs(refreshedA.runAfter.getTime() - refreshedB.runAfter.getTime())).toBeLessThan(2000);
  });

  describe("per-site backoff", () => {
    const cleanupVideoIds: string[] = [];
    afterEach(async () => {
      await db.job.deleteMany({ where: { videoId: { in: cleanupVideoIds } } });
      await db.video.deleteMany({ where: { id: { in: cleanupVideoIds.splice(0) } } });
    });
    const video = async (youtubeId: string, youtubeUrl: string) => {
      const created = await db.video.create({ data: { youtubeId: `${youtubeId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, title: youtubeId, youtubeUrl } });
      cleanupVideoIds.push(created.id);
      return created;
    };

    it("pauses only that site's queued jobs when Bilibili blocks a download", async () => {
      const bilibiliA = await video("bilibili.BV1aaaaaaaaa", "https://www.bilibili.com/video/BV1aaaaaaaaa");
      const bilibiliB = await video("bilibili.BV1bbbbbbbbb", "https://www.bilibili.com/video/BV1bbbbbbbbb");
      const youtube = await video("rtX9Fof1muY", "https://www.youtube.com/watch?v=rtX9Fof1muY");
      const failing = await db.job.create({ data: { type: "download", attempts: 1, status: "running", videoId: bilibiliA.id } });
      const sameSite = await db.job.create({ data: { type: "metadata", attempts: 0, status: "queued", videoId: bilibiliB.id } });
      const otherSite = await db.job.create({ data: { type: "download", attempts: 0, status: "queued", videoId: youtube.id } });
      cleanupJobIds.push(failing.id, sameSite.id, otherSite.id);

      const before = Date.now();
      await handleJobFailure(failing, new Error("/opt/homebrew/bin/yt-dlp failed: ERROR: [BiliBili] 1aaaaaaaaa: Unable to extract initial state; please report this issue on https://github.com/yt-dlp/yt-dlp/issues"));

      const [refreshedFailing, refreshedSame, refreshedOther] = await Promise.all([failing, sameSite, otherSite].map((job) => db.job.findUniqueOrThrow({ where: { id: job.id } })));
      expect(refreshedFailing).toMatchObject({ status: "queued", attempts: 0 });
      expect(refreshedFailing.runAfter.getTime()).toBeGreaterThan(before + 90_000);
      expect(Math.abs(refreshedSame.runAfter.getTime() - refreshedFailing.runAfter.getTime())).toBeLessThan(2000);
      // YouTube keeps downloading while Bilibili cools down.
      expect(refreshedOther.runAfter.getTime()).toBeLessThan(before + 60_000);
    });

    it("treats a SITE_RATE_LIMITED error from runYtDlp as a block", async () => {
      const bilibili = await video("bilibili.BV1ccccccccc", "https://www.bilibili.com/video/BV1ccccccccc");
      const failing = await db.job.create({ data: { type: "metadata", attempts: 1, status: "running", videoId: bilibili.id } });
      cleanupJobIds.push(failing.id);
      await handleJobFailure(failing, new Error("Bilibili is refusing requests from this connection (rate limit or bot protection). Queued jobs for Bilibili back off and retry automatically."));
      expect(await db.job.findUniqueOrThrow({ where: { id: failing.id } })).toMatchObject({ status: "queued", attempts: 0 });
    });

    it("doesn't treat a Bilibili-only signal as a block for another site", async () => {
      const youtube = await video("abcdefghijk", "https://www.youtube.com/watch?v=abcdefghijk");
      const failing = await db.job.create({ data: { type: "download", attempts: 1, maxAttempts: 3, status: "running", videoId: youtube.id } });
      cleanupJobIds.push(failing.id);
      await handleJobFailure(failing, new Error("yt-dlp failed: ERROR: [youtube] abcdefghijk: Unable to extract initial state"));
      expect((await db.job.findUniqueOrThrow({ where: { id: failing.id } })).attempts).toBe(1);
    });
  });

  it("falls back to the ordinary per-job backoff for a non-rate-limit failure", async () => {
    const job = await db.job.create({ data: { type: "download", attempts: 1, maxAttempts: 3, status: "running" } });
    cleanupJobIds.push(job.id);

    const before = Date.now();
    await handleJobFailure(job, new Error("yt-dlp failed: ERROR: Video unavailable"));

    const refreshed = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(refreshed.status).toBe("queued");
    expect(refreshed.attempts).toBe(1); // unchanged -- only the rate-limit path undoes claimJob's increment
    const secondsUntil = (refreshed.runAfter.getTime() - before) / 1000;
    expect(secondsUntil).toBeLessThanOrEqual(60);
  });

  it("fails a VideoUnavailableError immediately instead of retrying", async () => {
    // downloadVideo()/cacheVideo() (lib/downloads/service.ts) already recorded the video as unavailable
    // and threw this in place of the raw yt-dlp error before handleJobFailure ever sees it -- retrying
    // would only waste yt-dlp calls on a video that will never come back.
    const job = await db.job.create({ data: { type: "download", attempts: 1, maxAttempts: 3, status: "running" } });
    cleanupJobIds.push(job.id);

    await handleJobFailure(job, new VideoUnavailableError("ERROR: [youtube] abc123: Video unavailable"));

    const refreshed = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(refreshed.status).toBe("failed");
    expect(refreshed.finishedAt).not.toBeNull();
    expect(refreshed.attempts).toBe(1); // never incremented further -- no retry attempt was made
    expect(refreshed.error).toContain("unavailable");
  });
});
