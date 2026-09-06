import { db } from "@/lib/db/client";
import { cacheVideo, downloadVideo, materializeForTunarr, retagVideo } from "@/lib/downloads/service";
import { writeLog } from "@/lib/logging/service";
import { enrichVideo } from "@/lib/metadata/service";
import { enqueueUniqueJob, syncSource } from "@/lib/sources/service";
import { getSettings } from "@/lib/settings/service";
import { publishSourceToTunarr, type PublishTunarrInput } from "@/lib/tunarr/service";
import { persistSourceThumbnails } from "@/lib/thumbnails/service";
import { isRateLimitedError } from "@/lib/youtube/ytdlp";
import { enqueueChannelJob } from "@/lib/channels/service";
import { scanLocalFolder } from "@/lib/ingest/local-scan";
import { renderMediaItem } from "@/lib/renders/service";
import { publishChannelToTunarr } from "@/lib/tunarr/channel-service";

const globalWorker = globalThis as unknown as {
  ytarrWorker?: Promise<void>;
  ytarrRecovered?: boolean;
  ytarrWakeTimer?: NodeJS.Timeout;
  ytarrRateLimitHits?: number;
  ytarrControllers?: Map<string, AbortController>;
};

function controllers() {
  return (globalWorker.ytarrControllers ??= new Map());
}

// Media-fetching job types that shell out to yt-dlp for the actual video bytes, as opposed to the light
// metadata/listing calls made by "sync" -- these are the ones worth pausing as a group on a 429.
const RATE_LIMITED_JOB_TYPES = ["download", "cache"];

// Job types whose underlying work actually listens for the AbortController below (they end up in
// runProcess()/fetch calls that take a signal) -- "retag" (a near-instant local ffmpeg remux) and
// "thumbnail" (a couple of quick image fetches) don't check it, so stopping one wouldn't do anything
// but leave the UI showing a request that never lands. Exported so lib/jobs/service.ts's stopJob() can
// reject those up front instead of silently no-oping.
export const STOPPABLE_JOB_TYPES = ["download", "cache", "sync", "metadata", "tunarr_publish", "tunarr_refresh", "render", "channel_publish"];

// Called by stopJob() (lib/jobs/service.ts) for a job that's currently claimed as "running". Returns
// false if no controller is registered for it (already finished, or never supported stopping), in which
// case the caller should report the job as not stoppable rather than pretending the request landed.
export function requestJobStop(jobId: string) {
  const controller = controllers().get(jobId);
  if (!controller) return false;
  controller.abort();
  return true;
}

// Thrown by the tunarr_refresh guard in handleJob() when other download/cache/sync jobs for the same
// source are still active. This is an expected, routine wait -- not a real failure -- so handleJobFailure
// logs and retries it distinctly from an ordinary job error below.
export class SourceJobsActiveError extends Error {}

async function recoverJobs() {
  if (globalWorker.ytarrRecovered) return;
  globalWorker.ytarrRecovered = true;
  await db.job.updateMany({
    where: { status: "running" },
    data: { status: "queued", error: "Recovered after TunarrTube restarted.", runAfter: new Date() }
  });
  await db.sourceVideo.updateMany({ where: { downloadStatus: "downloading" }, data: { downloadStatus: "queued" } });
}

async function claimJob() {
  const now = new Date();
  // Three priority tiers so a large backlog of slow, network-bound jobs can never starve fast ones behind
  // it in strict creation order: "retag" is a purely local ffmpeg remux (no network, near-instant) so it
  // always goes first; other non-download jobs (metadata, thumbnail, sync, cache, tunarr_*) are quick
  // network calls and go next; "download" (slow yt-dlp calls, up to a 12h timeout each) goes last.
  const candidate =
    (await db.job.findFirst({ where: { status: "queued", runAfter: { lte: now }, type: "retag" }, orderBy: { createdAt: "asc" } })) ??
    (await db.job.findFirst({ where: { status: "queued", runAfter: { lte: now }, type: { notIn: ["download", "retag"] } }, orderBy: { createdAt: "asc" } })) ??
    (await db.job.findFirst({ where: { status: "queued", runAfter: { lte: now }, type: "download" }, orderBy: { createdAt: "asc" } }));
  if (!candidate) return null;
  const claimed = await db.job.updateMany({ where: { id: candidate.id, status: "queued" }, data: { status: "running", startedAt: new Date(), attempts: { increment: 1 }, error: null } });
  return claimed.count === 1 ? db.job.findUnique({ where: { id: candidate.id } }) : null;
}

async function handleJob(job: NonNullable<Awaited<ReturnType<typeof claimJob>>>, signal: AbortSignal) {
  if (job.type === "metadata" && job.videoId) return enrichVideo(job.videoId, signal);
  if (job.type === "thumbnail" && job.sourceId) return persistSourceThumbnails(job.sourceId);
  if (job.type === "sync" && job.sourceId) return syncSource(job.sourceId, signal);
  if (job.type === "download" && job.sourceId && job.videoId) return downloadVideo(job.sourceId, job.videoId, signal);
  if (job.type === "cache" && job.videoId) return cacheVideo(job.videoId, job.sourceId ?? undefined, signal);
  if (job.type === "retag" && job.sourceId && job.videoId) return retagVideo(job.sourceId, job.videoId);
  if (job.type === "tunarr_publish" && job.sourceId && job.payloadJson) {
    return publishSourceToTunarr(job.sourceId, JSON.parse(job.payloadJson) as PublishTunarrInput, signal);
  }
  if (job.type === "tunarr_refresh" && job.sourceId) {
    const source = await db.source.findUnique({ where: { id: job.sourceId } });
    if (!source?.tunarrChannelId || !source.tunarrChannelName) return;
    const active = await db.job.count({ where: { sourceId: job.sourceId, id: { not: job.id }, type: { in: ["download", "cache", "sync"] }, status: { in: ["queued", "running"] } } });
    if (active) throw new SourceJobsActiveError("Waiting for source media jobs before refreshing Tunarr.");
    return publishSourceToTunarr(job.sourceId, { channelName: source.tunarrChannelName, channelNumber: source.tunarrRequestedChannelNumber ?? undefined, programmingOrder: source.tunarrProgrammingOrder as PublishTunarrInput["programmingOrder"], prefetch: false }, signal);
  }
  if (job.type === "ingest_local_scan" && job.channelId && job.payloadJson) {
    const { folderPath } = JSON.parse(job.payloadJson) as { folderPath: string };
    return scanLocalFolder(job.channelId, folderPath);
  }
  if (job.type === "render" && job.mediaItemId && job.payloadJson) {
    const { templateId } = JSON.parse(job.payloadJson) as { templateId: string };
    return renderMediaItem(job.mediaItemId, templateId, signal);
  }
  if (job.type === "channel_publish" && job.channelId) {
    return publishChannelToTunarr(job.channelId, signal);
  }
  throw new Error(`Invalid ${job.type} job payload.`);
}

// Shared by the runner's stop-abort path below and cancelJob() (lib/jobs/service.ts, the queued-job
// case) so both land on the same terminal state: the Job row cancelled, and the SourceVideo/CacheAsset
// it was working on marked "cancelled" (sticky, so syncSource/materializeForTunarr's automatic
// re-enqueue paths leave it alone until an explicit retry).
export async function markJobCancelled(job: { id: string; type: string; sourceId: string | null; videoId: string | null }, message: string) {
  await db.job.update({ where: { id: job.id }, data: { status: "cancelled", error: message, finishedAt: new Date() } }).catch(() => undefined);
  if (job.type === "download" && job.sourceId && job.videoId) {
    await db.sourceVideo.update({ where: { sourceId_videoId: { sourceId: job.sourceId, videoId: job.videoId } }, data: { downloadStatus: "cancelled" } }).catch(() => undefined);
  }
  if (job.type === "cache" && job.videoId) {
    await db.cacheAsset.updateMany({ where: { videoId: job.videoId }, data: { status: "cancelled", error: null } });
  }
}

// Exported so tests can exercise the rate-limit-vs-ordinary-failure branching directly, without going
// through claimJob()/work()'s table-wide scan -- that scan has no per-test scoping, so driving it from a
// test risks racing a *different* test file's own kickWorker() call over the same shared dev database.
export async function handleJobFailure(job: NonNullable<Awaited<ReturnType<typeof claimJob>>>, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (job.type === "sync" && job.sourceId) {
    await db.source.update({ where: { id: job.sourceId }, data: { lastSyncStatus: "failed" } }).catch(() => undefined);
  }
  if (RATE_LIMITED_JOB_TYPES.includes(job.type) && isRateLimitedError(message)) {
    // YouTube is throttling us, not rejecting this particular video: don't burn one of the job's
    // limited attempts on it (undo claimJob's increment), and don't just delay this one job -- push
    // every other queued download/cache job's runAfter out too, so the whole queue backs off together
    // instead of the next job immediately tripping the same 429. Escalate the cooldown on repeated
    // hits and reset it (see the success path in work()) once a download actually gets through.
    const hits = (globalWorker.ytarrRateLimitHits ?? 0) + 1;
    globalWorker.ytarrRateLimitHits = hits;
    const cooldownSeconds = Math.min(30 * 60, 120 * 2 ** (hits - 1));
    const cooldownUntil = new Date(Date.now() + cooldownSeconds * 1000);
    await db.job.update({
      where: { id: job.id },
      data: { status: "queued", attempts: { decrement: 1 }, error: message.slice(-2000), runAfter: cooldownUntil, finishedAt: null }
    }).catch(() => undefined);
    await db.job.updateMany({
      where: { status: "queued", type: { in: RATE_LIMITED_JOB_TYPES }, id: { not: job.id }, runAfter: { lt: cooldownUntil } },
      data: { runAfter: cooldownUntil }
    });
    await writeLog({
      level: "warn", category: job.type, sourceId: job.sourceId ?? undefined, videoId: job.videoId ?? undefined,
      message: `YouTube rate-limited (429) on ${job.type}; pausing download/cache jobs for ${cooldownSeconds}s.`
    });
    return;
  }
  const retry = job.attempts < job.maxAttempts;
  const delaySeconds = Math.min(60, 2 ** job.attempts * 2);
  await db.job.update({
    where: { id: job.id },
    data: { status: retry ? "queued" : "failed", error: message.slice(-2000), runAfter: new Date(Date.now() + delaySeconds * 1000), finishedAt: retry ? null : new Date() }
  }).catch(() => undefined);
  if (error instanceof SourceJobsActiveError) {
    // Routine deferral, not a failure: log it quietly so it doesn't read like an incident in the logs
    // while other jobs for the source are still in flight. tunarr_refresh's generous maxAttempts (100,
    // see enqueueUniqueJob) means it keeps retrying well past the point an ordinary job would give up.
    await writeLog({ level: "info", category: job.type, sourceId: job.sourceId ?? undefined, videoId: job.videoId ?? undefined, message: `${job.type} job deferred: ${message}` });
    return;
  }
  await writeLog({ level: "error", category: job.type, sourceId: job.sourceId ?? undefined, videoId: job.videoId ?? undefined, message: `${job.type} job failed: ${message}` });
}

async function work() {
  await recoverJobs();
  for (;;) {
    // Checked before every claim (not just once at the top) so a pause requested mid-drain takes effect
    // between jobs -- it never interrupts whichever job is already running, that's what stopJob()/
    // requestJobStop() above are for.
    if ((await getSettings()).jobsPaused) return;
    const job = await claimJob();
    if (!job) return;
    const controller = new AbortController();
    controllers().set(job.id, controller);
    try {
      await handleJob(job, controller.signal);
      if (RATE_LIMITED_JOB_TYPES.includes(job.type)) globalWorker.ytarrRateLimitHits = 0;
      await db.job.update({ where: { id: job.id }, data: { status: "complete", finishedAt: new Date() } }).catch(() => undefined);
      if (["download", "cache", "retag"].includes(job.type) && job.sourceId) {
        const linked = await db.source.findUnique({ where: { id: job.sourceId }, select: { tunarrChannelId: true } });
        if (linked?.tunarrChannelId) {
          if (job.type === "cache" && job.videoId) await materializeForTunarr(job.sourceId, job.videoId);
          await enqueueUniqueJob("tunarr_refresh", job.sourceId);
        }
      }
      // Mirrors the download/cache/retag -> tunarr_refresh chain above: a completed render should
      // republish any already-Tunarr-linked channel that uses this media item, same as a completed
      // download refreshes an already-linked source's channel.
      if (job.type === "render" && job.mediaItemId) {
        const linkedChannels = await db.channel.findMany({
          where: { tunarrChannelId: { not: null }, items: { some: { mediaItemId: job.mediaItemId } } },
          select: { id: true }
        });
        for (const linked of linkedChannels) await enqueueChannelJob("channel_publish", { channelId: linked.id });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        await markJobCancelled(job, "Stopped by user.");
        await writeLog({ category: job.type, sourceId: job.sourceId ?? undefined, videoId: job.videoId ?? undefined, message: `${job.type} job stopped by user.` });
      } else {
        await handleJobFailure(job, error);
      }
    } finally {
      controllers().delete(job.id);
    }
  }
}

export function kickWorker() {
  if (globalWorker.ytarrWakeTimer) { clearTimeout(globalWorker.ytarrWakeTimer); globalWorker.ytarrWakeTimer = undefined; }
  if (!globalWorker.ytarrWorker) {
    globalWorker.ytarrWorker = work().finally(async () => {
      globalWorker.ytarrWorker = undefined;
      if ((await getSettings()).jobsPaused) return;
      const next = await db.job.findFirst({ where: { status: "queued" }, orderBy: { runAfter: "asc" }, select: { runAfter: true } });
      if (next) {
        const delay = Math.max(25, Math.min(60_000, next.runAfter.getTime() - Date.now()));
        globalWorker.ytarrWakeTimer = setTimeout(() => kickWorker(), delay);
        globalWorker.ytarrWakeTimer.unref();
      }
    });
  }
  return globalWorker.ytarrWorker;
}
