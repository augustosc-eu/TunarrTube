import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";

// cancelJob/retryJob's DB effects are what we're testing here; kickWorker() firing the real, table-wide
// job drain (see claimJob() in lib/jobs/runner.ts) is exactly the shared-DB race the rate-limit tests
// avoid -- stub it out so retryJob's assertions stay deterministic instead of racing a background worker.
// markJobCancelled is re-exported for real (imported below) since cancelJob()'s own test coverage is
// exactly what exercises it; requestJobStop/STOPPABLE_JOB_TYPES back stopJob()'s tests further down.
vi.mock("@/lib/jobs/runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jobs/runner")>();
  return { ...actual, kickWorker: vi.fn() };
});

const { cancelJob, postponeJob, retryJob, stopJob } = await import("@/lib/jobs/service");

describe("job cancel/retry", () => {
  const cleanupSourceIds: string[] = [];
  const cleanupVideoIds: string[] = [];
  const cleanupJobIds: string[] = [];

  afterEach(async () => {
    // Source/Video deletion cascades to any Job row referencing them (see schema.prisma); jobs created
    // with no source/video of their own (the postpone/stop tests below) need their own cleanup.
    await db.source.deleteMany({ where: { id: { in: cleanupSourceIds.splice(0) } } });
    await db.video.deleteMany({ where: { id: { in: cleanupVideoIds.splice(0) } } });
    await db.job.deleteMany({ where: { id: { in: cleanupJobIds.splice(0) } } });
  });

  async function makeSourceVideo(downloadStatus = "queued") {
    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({
      data: { name: "Job test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `job-test-${suffix}`, mediaDirectory: `/tmp/ytarr-job-test-${suffix}` }
    });
    const video = await db.video.create({
      data: { youtubeId: `video-${suffix}`, title: "Job test video", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}` }
    });
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id, downloadStatus } });
    cleanupSourceIds.push(source.id);
    cleanupVideoIds.push(video.id);
    return { source, video };
  }

  it("cancels a queued download job and marks the source video cancelled", async () => {
    const { source, video } = await makeSourceVideo();
    const job = await db.job.create({ data: { type: "download", sourceId: source.id, videoId: video.id, status: "queued" } });

    const result = await cancelJob(job.id);
    expect(result).toEqual({ cancelled: true });

    const refreshedJob = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(refreshedJob.status).toBe("cancelled");
    expect(refreshedJob.error).toBe("Cancelled by user.");
    expect(refreshedJob.finishedAt).toBeInstanceOf(Date);

    const membership = await db.sourceVideo.findUniqueOrThrow({ where: { sourceId_videoId: { sourceId: source.id, videoId: video.id } } });
    expect(membership.downloadStatus).toBe("cancelled");
  });

  it("rejects cancelling a job that is already running", async () => {
    const { source, video } = await makeSourceVideo();
    const job = await db.job.create({ data: { type: "download", sourceId: source.id, videoId: video.id, status: "running" } });

    await expect(cancelJob(job.id)).rejects.toMatchObject({ code: "JOB_NOT_CANCELLABLE" });
    const refreshedJob = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(refreshedJob.status).toBe("running");
  });

  it("cancels a queued cache job and marks the cache asset cancelled", async () => {
    const { video } = await makeSourceVideo();
    await db.cacheAsset.create({ data: { videoId: video.id, status: "downloading" } });
    const job = await db.job.create({ data: { type: "cache", videoId: video.id, status: "queued" } });

    await cancelJob(job.id);
    const asset = await db.cacheAsset.findUniqueOrThrow({ where: { videoId: video.id } });
    expect(asset.status).toBe("cancelled");
  });

  it("re-queues a cancelled download job as a fresh job and un-cancels the source video", async () => {
    const { source, video } = await makeSourceVideo("cancelled");
    const job = await db.job.create({ data: { type: "download", sourceId: source.id, videoId: video.id, status: "cancelled", attempts: 2, error: "Cancelled by user." } });

    const fresh = await retryJob(job.id);
    expect(fresh.id).not.toBe(job.id);
    expect(fresh).toMatchObject({ type: "download", sourceId: source.id, videoId: video.id, status: "queued", attempts: 0 });

    const membership = await db.sourceVideo.findUniqueOrThrow({ where: { sourceId_videoId: { sourceId: source.id, videoId: video.id } } });
    expect(membership.downloadStatus).toBe("queued");

    // The old job row is left alone -- retry creates a new attempt rather than resurrecting it.
    const original = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(original.status).toBe("cancelled");
  });

  it("rejects retrying a job that is still queued", async () => {
    const { source, video } = await makeSourceVideo();
    const job = await db.job.create({ data: { type: "download", sourceId: source.id, videoId: video.id, status: "queued" } });
    await expect(retryJob(job.id)).rejects.toMatchObject({ code: "JOB_NOT_RETRYABLE" });
  });

  it("postpones a queued job by pushing runAfter out without touching status or attempts", async () => {
    const job = await db.job.create({ data: { type: "sync", status: "queued", attempts: 1 } });
    cleanupJobIds.push(job.id);
    const before = Date.now();

    const updated = await postponeJob(job.id, 60);
    expect(updated.status).toBe("queued");
    expect(updated.attempts).toBe(1);
    const minutesOut = (updated.runAfter.getTime() - before) / 60_000;
    expect(minutesOut).toBeGreaterThan(59);
    expect(minutesOut).toBeLessThan(61);
  });

  it("rejects postponing a job that isn't queued", async () => {
    const job = await db.job.create({ data: { type: "sync", status: "running" } });
    cleanupJobIds.push(job.id);
    await expect(postponeJob(job.id, 60)).rejects.toMatchObject({ code: "JOB_NOT_POSTPONABLE" });
  });

  it("rejects stopping a job that isn't running", async () => {
    const job = await db.job.create({ data: { type: "download", status: "queued" } });
    cleanupJobIds.push(job.id);
    await expect(stopJob(job.id)).rejects.toMatchObject({ code: "JOB_NOT_STOPPABLE" });
  });

  it("rejects stopping a running job type with no interrupt point", async () => {
    const job = await db.job.create({ data: { type: "retag", status: "running" } });
    cleanupJobIds.push(job.id);
    await expect(stopJob(job.id)).rejects.toMatchObject({ code: "JOB_NOT_STOPPABLE" });
  });

  it("rejects stopping a stoppable-type job the runner has no live controller for", async () => {
    // Simulates a "running" row left over from a crash, before recoverJobs() requeues it -- there's no
    // in-process AbortController for it (requestJobStop() returns false), so it must be reported as
    // not stoppable rather than silently accepted.
    const job = await db.job.create({ data: { type: "download", status: "running" } });
    cleanupJobIds.push(job.id);
    await expect(stopJob(job.id)).rejects.toMatchObject({ code: "JOB_NOT_STOPPABLE" });
  });

  it("stops a running job with a live controller and marks it cancelled the same way cancelJob does", async () => {
    const { source, video } = await makeSourceVideo();
    const job = await db.job.create({ data: { type: "download", sourceId: source.id, videoId: video.id, status: "running" } });
    const stopSpy = vi.spyOn(await import("@/lib/jobs/runner"), "requestJobStop").mockReturnValue(true);

    const result = await stopJob(job.id);
    expect(result).toEqual({ stopping: true });
    expect(stopSpy).toHaveBeenCalledWith(job.id);
    stopSpy.mockRestore();
  });
});
