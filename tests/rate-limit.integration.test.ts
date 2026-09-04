import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
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
});
