import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";

// cancelJob/retryJob's DB effects are what we're testing here; kickWorker() firing the real, table-wide
// job drain (see claimJob() in lib/jobs/runner.ts) is exactly the shared-DB race the rate-limit tests
// avoid -- stub it out so retryJob's assertions stay deterministic instead of racing a background worker.
vi.mock("@/lib/jobs/runner", () => ({ kickWorker: vi.fn() }));

const { cancelJob, retryJob } = await import("@/lib/jobs/service");

describe("job cancel/retry", () => {
  const cleanupSourceIds: string[] = [];
  const cleanupVideoIds: string[] = [];

  afterEach(async () => {
    await db.source.deleteMany({ where: { id: { in: cleanupSourceIds.splice(0) } } });
    await db.video.deleteMany({ where: { id: { in: cleanupVideoIds.splice(0) } } });
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
});
