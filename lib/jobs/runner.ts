import { db } from "@/lib/db/client";
import { cacheVideo, downloadVideo, materializeForTunarr, retagVideo, VideoUnavailableError } from "@/lib/downloads/service";
import { sanitizeLogValue, writeLog } from "@/lib/logging/service";
import { enrichVideo } from "@/lib/metadata/service";
import { enqueueUniqueJob, syncSource } from "@/lib/sources/service";
import { getSettings } from "@/lib/settings/service";
import { publishSourceToTunarr, type PublishTunarrInput } from "@/lib/tunarr/service";
import { persistSourceThumbnails } from "@/lib/thumbnails/service";
import { isRateLimitedError } from "@/lib/youtube/ytdlp";
import { enqueueChannelJob, runChannelBrief, runContentSelection } from "@/lib/channels/service";
import { scanLocalFolder } from "@/lib/ingest/local-scan";
import { renderMediaItem } from "@/lib/renders/service";
import { publishChannelToTunarr } from "@/lib/tunarr/channel-service";

const globalWorker = globalThis as unknown as {
  ytarrLanes?: Map<string, Promise<void>>;
  ytarrRecovered?: boolean;
  ytarrRecovery?: Promise<void>;
  ytarrWakeTimer?: NodeJS.Timeout;
  ytarrRateLimitHits?: number;
  ytarrControllers?: Map<string, AbortController>;
};

function controllers() {
  return (globalWorker.ytarrControllers ??= new Map());
}

function lanes() {
  return (globalWorker.ytarrLanes ??= new Map());
}

// Media-fetching job types that shell out to yt-dlp for the actual video bytes, as opposed to the light
// metadata/listing calls made by "sync" -- these are the ones worth pausing as a group on a 429, and the
// only ones kept to a single worker below (see LANE_IDS) so we never fire concurrent requests at
// YouTube's video CDN.
const RATE_LIMITED_JOB_TYPES = ["download", "cache"];

// How many "general" jobs (everything except download/cache -- metadata, thumbnail, sync, retag,
// tunarr_*, render, channel_*, ingest_local_scan) run at once. These are lighter than a video download
// (an API call, a quick yt-dlp metadata-only call, or purely local work) and aren't the ones YouTube's
// 429s are aimed at pausing, so running several concurrently speeds up a large backlog without touching
// the download/cache rate-limit story at all. Override via env for tuning; default keeps it modest.
const GENERAL_LANE_COUNT = Number(process.env.TUNARRTUBE_GENERAL_WORKERS) || 3;

// One lane per concurrently-running worker loop: "media" claims only download/cache jobs and runs
// strictly one at a time (see claimJob() below); "general-0".."general-N" each independently claim and
// run everything else, so up to GENERAL_LANE_COUNT of those can be in flight together. kickWorker()
// starts whichever lanes aren't already running; each lane's work() loop exits (and is removed from the
// map) once the queue it draws from is empty.
const LANE_IDS = ["media", ...Array.from({ length: GENERAL_LANE_COUNT }, (_, index) => `general-${index}`)];

function laneKind(id: string): "media" | "general" {
  return id === "media" ? "media" : "general";
}

// Job types whose underlying work actually listens for the AbortController below (they end up in
// runProcess()/fetch calls that take a signal) -- "retag" (a near-instant local ffmpeg remux) and
// "thumbnail" (a couple of quick image fetches) don't check it, so stopping one wouldn't do anything
// but leave the UI showing a request that never lands. Exported so lib/jobs/service.ts's stopJob() can
// reject those up front instead of silently no-oping.
export const STOPPABLE_JOB_TYPES = ["download", "cache", "sync", "metadata", "tunarr_publish", "tunarr_refresh", "render", "channel_publish", "content_select", "channel_brief"];

// Called by stopJob() (lib/jobs/service.ts) for a job that's currently claimed as "running". Returns
// false if no controller is registered (an orphaned row or a claim still being registered).
// stopJob persists cancellation in either case; the worker checks it before dispatching.
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

// Exported so tests can exercise startup recovery directly rather than through kickWorker()/work()'s
// table-wide scan -- that scan has no per-test scoping, so driving it from a test risks racing a
// *different* test file's own kickWorker() call over the same shared dev database (same reasoning as
// handleJobFailure's export above). Tests should clear globalWorker.ytarrRecovered first so the
// once-per-process guard below doesn't skip the call.
export async function recoverJobs() {
  if (globalWorker.ytarrRecovered) return;
  // All lanes must await the same recovery pass before any of them can claim work.
  globalWorker.ytarrRecovery ??= (async () => {
    const interrupted = await db.job.findMany({ where: { status: "running" } });
    for (const job of interrupted) {
      const exhausted = job.attempts >= job.maxAttempts;
      const message = exhausted
        ? "Interrupted by restart; retry limit reached. Retry manually from Queue."
        : "Recovered after TunarrTube restarted.";
      const changed = await db.job.updateMany({
        where: { id: job.id, status: "running" },
        data: { status: exhausted ? "failed" : "queued", error: message, runAfter: new Date(),
          startedAt: null, finishedAt: exhausted ? new Date() : null }
      });
      if (changed.count && exhausted && job.type === "download" && job.sourceId && job.videoId) {
        await db.sourceVideo.updateMany({
          where: { sourceId: job.sourceId, videoId: job.videoId, downloadStatus: "downloading" },
          data: { downloadStatus: "failed" }
        });
      }
      if (changed.count && exhausted && job.type === "cache" && job.videoId) {
        await db.cacheAsset.updateMany({ where: { videoId: job.videoId, status: "downloading" }, data: { status: "failed", error: message } });
      }
      if (changed.count) await writeLog({ category: job.type, level: "warn", message,
        sourceId: job.sourceId ?? undefined, videoId: job.videoId ?? undefined,
        details: { jobId: job.id, attempts: job.attempts, maxAttempts: job.maxAttempts }
      }).catch(() => undefined);
    }
    await db.sourceVideo.updateMany({ where: { downloadStatus: "downloading" }, data: { downloadStatus: "queued" } });
    // CacheAsset.activeReaders is incremented in-process for the duration of a playback stream
    // (lib/playback/service.ts) and only decremented via that stream's close/error/end handlers -- a
    // restart while a client had a cached file open leaves it stuck above zero forever, since nothing
    // else ever clears it. That then permanently blocks the asset from cache eviction (it reads as
    // "still playing"). Since a fresh process has no live streams yet, any nonzero count left over from
    // before the restart is necessarily stale.
    await db.cacheAsset.updateMany({ where: { activeReaders: { gt: 0 } }, data: { activeReaders: 0 } });
    globalWorker.ytarrRecovered = true;
  })();
  try {
    await globalWorker.ytarrRecovery;
  } finally {
    globalWorker.ytarrRecovery = undefined;
  }
}

async function claimJob(lane: "media" | "general") {
  const now = new Date();
  // The media lane only ever claims download/cache jobs (kept single-worker by work()/kickWorker() below
  // running exactly one "media" lane) -- everything else goes to the general lanes, "retag" prioritized
  // first since it's a purely local ffmpeg remux (no network, near-instant) that shouldn't have to wait
  // behind slower network-bound work in strict creation order.
  const candidate = lane === "media"
    ? await db.job.findFirst({ where: { status: "queued", runAfter: { lte: now }, type: { in: RATE_LIMITED_JOB_TYPES } }, orderBy: { createdAt: "asc" } })
    : (await db.job.findFirst({ where: { status: "queued", runAfter: { lte: now }, type: "retag" }, orderBy: { createdAt: "asc" } })) ??
      (await db.job.findFirst({ where: { status: "queued", runAfter: { lte: now }, type: { notIn: [...RATE_LIMITED_JOB_TYPES, "retag"] } }, orderBy: { createdAt: "asc" } }));
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
  if (job.type === "content_select" && job.channelId && job.payloadJson) {
    const payload = JSON.parse(job.payloadJson) as { sourceIds: string[]; instructions: string; targetCount?: number; providerOverride?: string | null };
    return runContentSelection(job.channelId, payload, signal);
  }
  if (job.type === "channel_brief" && job.channelId && job.payloadJson) {
    const payload = JSON.parse(job.payloadJson) as { sourceIds: string[] };
    return runChannelBrief(job.channelId, payload, signal);
  }
  throw new Error(`Invalid ${job.type} job payload.`);
}

// Shared by the runner's stop-abort path below and cancelJob() (lib/jobs/service.ts, the queued-job
// case) so both land on the same terminal state: the Job row cancelled, and the SourceVideo/CacheAsset
// it was working on marked "cancelled" (sticky, so syncSource/materializeForTunarr's automatic
// re-enqueue paths leave it alone until an explicit retry).
export async function markJobCancelled(job: { id: string; type: string; sourceId: string | null; videoId: string | null }, message: string) {
  const changed = await db.job.updateMany({ where: { id: job.id, status: { in: ["queued", "running"] } }, data: { status: "cancelled", error: message, finishedAt: new Date() } });
  if (!changed.count) return false;
  if (job.type === "download" && job.sourceId && job.videoId) {
    await db.sourceVideo.update({ where: { sourceId_videoId: { sourceId: job.sourceId, videoId: job.videoId } }, data: { downloadStatus: "cancelled" } }).catch(() => undefined);
  }
  if (job.type === "cache" && job.videoId) {
    await db.cacheAsset.updateMany({ where: { videoId: job.videoId }, data: { status: "cancelled", error: null } });
  }
  return true;
}

// Exported so tests can exercise the rate-limit-vs-ordinary-failure branching directly, without going
// through claimJob()/work()'s table-wide scan -- that scan has no per-test scoping, so driving it from a
// test risks racing a *different* test file's own kickWorker() call over the same shared dev database.
export async function handleJobFailure(job: NonNullable<Awaited<ReturnType<typeof claimJob>>>, error: unknown) {
  const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
  if ((await db.job.findUnique({ where: { id: job.id } }))?.status !== "running") return;
  // Every writeLog() call below is best-effort, like the db.job.update() calls beside them -- a Source or
  // Video this job referenced can be deleted out from under it while it's mid-failure (deleteSource()
  // guards against that in the normal app flow, but nothing stops a raw DB delete elsewhere, e.g. a
  // test's own cleanup), which would otherwise surface as an unhandled rejection over a FK constraint
  // that has nothing to do with the job's own outcome.
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
    await db.job.updateMany({
      where: { id: job.id, status: "running" },
      data: { status: "queued", attempts: { decrement: 1 }, error: message.slice(-2000), runAfter: cooldownUntil, finishedAt: null }
    }).catch(() => undefined);
    await db.job.updateMany({
      where: { status: "queued", type: { in: RATE_LIMITED_JOB_TYPES }, id: { not: job.id }, runAfter: { lt: cooldownUntil } },
      data: { runAfter: cooldownUntil }
    });
    await writeLog({
      level: "warn", category: job.type, sourceId: job.sourceId ?? undefined, videoId: job.videoId ?? undefined,
      message: `YouTube rate-limited (429) on ${job.type}; pausing download/cache jobs for ${cooldownSeconds}s.`
    }).catch(() => undefined);
    return;
  }
  if (error instanceof VideoUnavailableError) {
    // downloadVideo()/cacheVideo() (lib/downloads/service.ts) already recorded the Video/SourceVideo as
    // unavailable before throwing this -- retrying would only waste yt-dlp calls on a video that will
    // never come back, so fail the job immediately instead of the ordinary retry-with-backoff below. The
    // Jobs page's Retry action still works if the user wants another attempt (e.g. YouTube later
    // reinstates it), or they can remove the video from its source instead.
    await db.job.updateMany({ where: { id: job.id, status: "running" }, data: { status: "failed", error: message.slice(-2000), finishedAt: new Date() } }).catch(() => undefined);
    await writeLog({ level: "warn", category: job.type, sourceId: job.sourceId ?? undefined, videoId: job.videoId ?? undefined, message: `${job.type} job failed: ${message} (video unavailable, not retrying)` }).catch(() => undefined);
    return;
  }
  const retry = job.attempts < job.maxAttempts;
  const delaySeconds = Math.min(60, 2 ** job.attempts * 2);
  await db.job.updateMany({
    where: { id: job.id, status: "running" },
    data: { status: retry ? "queued" : "failed", error: message.slice(-2000), runAfter: new Date(Date.now() + delaySeconds * 1000), finishedAt: retry ? null : new Date() }
  }).catch(() => undefined);
  if (error instanceof SourceJobsActiveError) {
    // Routine deferral, not a failure: log it quietly so it doesn't read like an incident in the logs
    // while other jobs for the source are still in flight. tunarr_refresh's generous maxAttempts (100,
    // see enqueueUniqueJob) means it keeps retrying well past the point an ordinary job would give up.
    await writeLog({ level: "info", category: job.type, sourceId: job.sourceId ?? undefined, videoId: job.videoId ?? undefined, message: `${job.type} job deferred: ${message}` }).catch(() => undefined);
    return;
  }
  await writeLog({ level: "error", category: job.type, sourceId: job.sourceId ?? undefined, videoId: job.videoId ?? undefined, message: `${job.type} job failed: ${message}` }).catch(() => undefined);
}

async function work(lane: "media" | "general") {
  await recoverJobs();
  for (;;) {
    // Checked before every claim (not just once at the top) so a pause requested mid-drain takes effect
    // between jobs -- it never interrupts whichever job is already running, that's what stopJob()/
    // requestJobStop() above are for.
    if ((await getSettings()).jobsPaused) return;
    const job = await claimJob(lane);
    if (!job) return;
    const controller = new AbortController();
    controllers().set(job.id, controller);
    try {
      // Stop can arrive between the claim and controller registration.
      if ((await db.job.findUnique({ where: { id: job.id } }))?.status !== "running") continue;
      await handleJob(job, controller.signal);
      controller.signal.throwIfAborted();
      if (RATE_LIMITED_JOB_TYPES.includes(job.type)) globalWorker.ytarrRateLimitHits = 0;
      const completed = await db.job.updateMany({ where: { id: job.id, status: "running" }, data: { status: "complete", finishedAt: new Date() } });
      if (!completed.count) continue;
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
        await writeLog({ category: job.type, sourceId: job.sourceId ?? undefined, videoId: job.videoId ?? undefined, message: `${job.type} job stopped by user.` }).catch(() => undefined);
      } else {
        await handleJobFailure(job, error);
      }
    } finally {
      controllers().delete(job.id);
    }
  }
}

// Called from each lane's finally() below once every lane has drained (checked via lanes().size so a lane
// that just finished doesn't schedule a wake while its siblings are still working through the queue --
// whichever lane finishes last is the one that actually gets past that check). Guards on ytarrWakeTimer
// too, since more than one lane can reach this within the same tick.
async function scheduleWakeIfIdle() {
  if (lanes().size) return;
  if (globalWorker.ytarrWakeTimer) return;
  if ((await getSettings()).jobsPaused) return;
  const next = await db.job.findFirst({ where: { status: "queued" }, orderBy: { runAfter: "asc" }, select: { runAfter: true } });
  if (!next) return;
  const delay = Math.max(25, Math.min(60_000, next.runAfter.getTime() - Date.now()));
  globalWorker.ytarrWakeTimer = setTimeout(() => kickWorker(), delay);
  globalWorker.ytarrWakeTimer.unref();
}

export function kickWorker() {
  if (globalWorker.ytarrWakeTimer) { clearTimeout(globalWorker.ytarrWakeTimer); globalWorker.ytarrWakeTimer = undefined; }
  for (const id of LANE_IDS) {
    if (lanes().has(id)) continue;
    const promise = work(laneKind(id)).finally(() => {
      lanes().delete(id);
      void scheduleWakeIfIdle();
    });
    lanes().set(id, promise);
  }
}
