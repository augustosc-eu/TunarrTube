import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { kickWorker } from "@/lib/jobs/runner";
import { enqueueUniqueJob } from "@/lib/sources/service";

export async function enqueueDownloads(items: Array<{ sourceId: string; videoId: string }>) {
  const jobs = [];
  for (const item of items) {
    const membership = await db.sourceVideo.findUnique({ where: { sourceId_videoId: item }, select: { id: true, downloadStatus: true } });
    if (!membership) throw new AppError("VIDEO_NOT_IN_SOURCE", "At least one selected video is not part of its source.", 404);
    if (membership.downloadStatus === "complete") continue;
    const job = await enqueueUniqueJob("download", item.sourceId, item.videoId, { target: "permanent" });
    await db.sourceVideo.update({ where: { id: membership.id }, data: { downloadStatus: "queued" } });
    jobs.push(job);
  }
  kickWorker();
  return jobs;
}

export async function getJob(id: string) {
  const job = await db.job.findUnique({ where: { id } });
  if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found.", 404);
  return job;
}
