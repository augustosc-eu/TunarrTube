import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { enqueueChannelJob } from "@/lib/channels/service";
import { enqueueActiveJobs } from "@/lib/jobs/enqueue";
import { kickWorker, markJobCancelled, requestJobStop, STOPPABLE_JOB_TYPES } from "@/lib/jobs/runner";
import { writeLog } from "@/lib/logging/service";
import { getSettings } from "@/lib/settings/service";
import { enqueueUniqueJob } from "@/lib/sources/service";

// Job types keyed by Channel/MediaItem rather than Source/SourceVideo -- see enqueueChannelJob
// (lib/channels/service.ts) for why these get their own dedupe-and-create path. retryJob() below
// needs to know which re-enqueue path applies to a given job's type.
const CHANNEL_TARGETED_JOB_TYPES = ["channel_publish", "render", "ingest_local_scan"];

export async function enqueueDownloads(items: Array<{ sourceId: string; videoId: string }>) {
  const uniqueItems = [...new Map(items.map((item) => [`${item.sourceId}\0${item.videoId}`, item])).values()];
  const memberships = uniqueItems.length ? await db.sourceVideo.findMany({
    where: { OR: uniqueItems },
    select: { id: true, sourceId: true, videoId: true, downloadStatus: true }
  }) : [];
  if (memberships.length !== uniqueItems.length) {
    throw new AppError("VIDEO_NOT_IN_SOURCE", "At least one selected video is not part of its source.", 404);
  }
  const eligible = memberships.filter((membership) => membership.downloadStatus !== "complete");
  const jobs = await enqueueActiveJobs(eligible.map((membership) => ({
    type: "download",
    sourceId: membership.sourceId,
    videoId: membership.videoId,
    payload: { target: "permanent" }
  })));
  if (eligible.length) {
    await db.sourceVideo.updateMany({
      where: { id: { in: eligible.map((membership) => membership.id) } },
      data: { downloadStatus: "queued" }
    });
  }
  kickWorker();
  return jobs;
}

export async function getJob(id: string) {
  const job = await db.job.findUnique({ where: { id } });
  if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found.", 404);
  return { ...job, stoppable: job.status === "running" && STOPPABLE_JOB_TYPES.includes(job.type) };
}

export async function getJobsStatus(ids: string[]) {
  const jobs = await db.job.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, status: true, error: true, runAfter: true, startedAt: true, finishedAt: true, updatedAt: true }
  });
  return jobs;
}

// Cancelling only reaches jobs still waiting in the queue (including ones sitting in a retry backoff) --
// a job already claimed as "running" has to be interrupted with stopJob() below instead. Cancellation is
// sticky: it marks the underlying SourceVideo/CacheAsset so automatic re-enqueue paths (syncSource,
// materializeForTunarr) leave it alone until retryJob() below.
export async function cancelJob(id: string) {
  const job = await db.job.findUnique({ where: { id } });
  if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found.", 404);
  if (job.status !== "queued") throw new AppError("JOB_NOT_CANCELLABLE", "Only a queued job can be cancelled; a running job must be stopped instead.", 409);
  await markJobCancelled(job, "Cancelled by user.");
  await writeLog({ category: job.type, sourceId: job.sourceId ?? undefined, videoId: job.videoId ?? undefined, message: `${job.type} job cancelled by user.` });
  return { cancelled: true };
}

// Persist the stop before signalling the worker, so a restart cannot resurrect it.
// A missing controller is an orphaned job (or a claim still registering its controller);
// cancellation must work for that case too.
export async function stopJob(id: string) {
  const job = await db.job.findUnique({ where: { id } });
  if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found.", 404);
  if (job.status !== "running") throw new AppError("JOB_NOT_STOPPABLE", "Only a running job can be stopped.", 409);
  if (!STOPPABLE_JOB_TYPES.includes(job.type)) {
    throw new AppError("JOB_NOT_STOPPABLE", "This job can't be interrupted; it has to finish on its own.", 409);
  }
  if (!await markJobCancelled(job, "Stopped by user.")) {
    throw new AppError("JOB_NOT_STOPPABLE", "This job has already finished.", 409);
  }
  requestJobStop(job.id);
  await writeLog({ category: job.type, sourceId: job.sourceId ?? undefined, videoId: job.videoId ?? undefined, message: `${job.type} job stopped by user.` });
  return { stopping: true };
}

// Pushes a still-queued job's runAfter into the future without touching its status or attempts --
// claimJob() (lib/jobs/runner.ts) only picks up jobs whose runAfter has already passed, so this just
// makes the worker wait longer before trying it. Distinct from cancelJob(): the job stays queued and
// will run on its own once the new time arrives, no retry needed.
export async function postponeJob(id: string, minutes: number) {
  const job = await db.job.findUnique({ where: { id } });
  if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found.", 404);
  if (job.status !== "queued") throw new AppError("JOB_NOT_POSTPONABLE", "Only a queued job can be postponed.", 409);
  const runAfter = new Date(Date.now() + minutes * 60_000);
  const updated = await db.job.update({ where: { id }, data: { runAfter } });
  await writeLog({ category: job.type, sourceId: job.sourceId ?? undefined, videoId: job.videoId ?? undefined, message: `${job.type} job postponed by user until ${runAfter.toISOString()}.` });
  return updated;
}

// The global on/off switch for the queue: setJobsPaused(true) stops the worker from claiming any new
// job (checked in work()/kickWorker(), lib/jobs/runner.ts) but never interrupts whichever job is already
// running -- pair it with stopJob() for "stop everything right now". Persisted on AppSettings so it
// survives a restart, unlike the in-process AbortController registry.
export async function setJobsPaused(paused: boolean) {
  await getSettings();
  const updated = await db.appSettings.update({ where: { id: 1 }, data: { jobsPaused: paused } });
  await writeLog({ category: "job", message: paused ? "Job queue paused by user." : "Job queue resumed by user." });
  if (!paused) kickWorker();
  return updated;
}

// Re-queues a cancelled or failed job as a brand-new Job row (fresh attempts counter) rather than
// resurrecting the old row. Source/SourceVideo-targeted jobs go through the same enqueueUniqueJob()
// every automatic path uses; Channel/MediaItem-targeted jobs (channel_publish, render,
// ingest_local_scan -- CHANNEL_TARGETED_JOB_TYPES above) have no sourceId/videoId to give it, so they
// go through enqueueChannelJob() instead. Using enqueueUniqueJob for those would silently create a Job
// row with sourceId/videoId/channelId/mediaItemId all null, which handleJob() (lib/jobs/runner.ts)
// then immediately fails as "Invalid <type> job payload." -- i.e. Retry would always fail for them.
export async function retryJob(id: string) {
  const job = await db.job.findUnique({ where: { id } });
  if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found.", 404);
  if (!["cancelled", "failed"].includes(job.status)) throw new AppError("JOB_NOT_RETRYABLE", "Only a cancelled or failed job can be retried.", 409);
  if (job.type === "download" && job.sourceId && job.videoId) {
    await db.sourceVideo.update({ where: { sourceId_videoId: { sourceId: job.sourceId, videoId: job.videoId } }, data: { downloadStatus: "queued" } }).catch(() => undefined);
  }
  if (job.type === "cache" && job.videoId) {
    await db.cacheAsset.updateMany({ where: { videoId: job.videoId, status: { in: ["cancelled", "failed"] } }, data: { status: "not_cached", error: null } });
  }
  const payload = job.payloadJson ? JSON.parse(job.payloadJson) : undefined;
  const fresh = CHANNEL_TARGETED_JOB_TYPES.includes(job.type)
    ? await enqueueChannelJob(job.type, { channelId: job.channelId ?? undefined, mediaItemId: job.mediaItemId ?? undefined }, payload)
    : await enqueueUniqueJob(job.type, job.sourceId ?? undefined, job.videoId ?? undefined, payload);
  await writeLog({ category: job.type, sourceId: job.sourceId ?? undefined, videoId: job.videoId ?? undefined, message: `${job.type} job retried by user.` });
  kickWorker();
  return fresh;
}

// Powers the /jobs queue view: running and queued jobs (the actual work in flight or waiting on the
// in-process worker lanes, see lib/jobs/runner.ts) plus a bounded tail of recent terminal jobs so
// finished/failed work stays visible for a bit after it clears the active queue. Also reports whether
// the queue is paused (setJobsPaused() above) so the UI can show the toggle's current state.
export async function listJobs(options: { queuedPage?: number; pageSize?: number } = {}) {
  const queuedPage = Math.max(1, options.queuedPage ?? 1);
  const pageSize = Math.min(100, Math.max(10, options.pageSize ?? 50));
  const include = {
    source: { select: { id: true, name: true } },
    video: { select: { id: true, title: true, youtubeId: true } }
  } as const;
  const [{ jobsPaused }, running, queuedTotal, queued, recent] = await Promise.all([
    getSettings(),
    db.job.findMany({ where: { status: "running" }, orderBy: { startedAt: "asc" }, include }),
    db.job.count({ where: { status: "queued" } }),
    db.job.findMany({
      where: { status: "queued" },
      orderBy: [{ runAfter: "asc" }, { createdAt: "asc" }],
      skip: (queuedPage - 1) * pageSize,
      take: pageSize,
      include
    }),
    db.job.findMany({ where: { status: { in: ["complete", "failed", "cancelled"] } }, orderBy: { finishedAt: "desc" }, take: 30, include })
  ]);
  return {
    paused: jobsPaused,
    running: running.map((job) => ({ ...job, stoppable: STOPPABLE_JOB_TYPES.includes(job.type) })),
    queued,
    queuedPagination: { page: queuedPage, pageSize, total: queuedTotal, totalPages: Math.max(1, Math.ceil(queuedTotal / pageSize)) },
    recent
  };
}
