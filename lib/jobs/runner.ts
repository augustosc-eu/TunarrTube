import { db } from "@/lib/db/client";
import { cacheVideo, downloadVideo, materializeForTunarr, retagVideo } from "@/lib/downloads/service";
import { writeLog } from "@/lib/logging/service";
import { enrichVideo } from "@/lib/metadata/service";
import { enqueueUniqueJob, syncSource } from "@/lib/sources/service";
import { publishSourceToTunarr, type PublishTunarrInput } from "@/lib/tunarr/service";
import { persistSourceThumbnails } from "@/lib/thumbnails/service";
import { isRateLimitedError } from "@/lib/youtube/ytdlp";

const globalWorker = globalThis as unknown as { ytarrWorker?: Promise<void>; ytarrRecovered?: boolean; ytarrWakeTimer?: NodeJS.Timeout; ytarrRateLimitHits?: number };

// Media-fetching job types that shell out to yt-dlp for the actual video bytes, as opposed to the light
// metadata/listing calls made by "sync" -- these are the ones worth pausing as a group on a 429.
const RATE_LIMITED_JOB_TYPES = ["download", "cache"];

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

async function handleJob(job: NonNullable<Awaited<ReturnType<typeof claimJob>>>) {
  if (job.type === "metadata" && job.videoId) return enrichVideo(job.videoId);
  if (job.type === "thumbnail" && job.sourceId) return persistSourceThumbnails(job.sourceId);
  if (job.type === "sync" && job.sourceId) return syncSource(job.sourceId);
  if (job.type === "download" && job.sourceId && job.videoId) return downloadVideo(job.sourceId, job.videoId);
  if (job.type === "cache" && job.videoId) return cacheVideo(job.videoId, job.sourceId ?? undefined);
  if (job.type === "retag" && job.sourceId && job.videoId) return retagVideo(job.sourceId, job.videoId);
  if (job.type === "tunarr_publish" && job.sourceId && job.payloadJson) {
    return publishSourceToTunarr(job.sourceId, JSON.parse(job.payloadJson) as PublishTunarrInput);
  }
  if (job.type === "tunarr_refresh" && job.sourceId) {
    const source = await db.source.findUnique({ where: { id: job.sourceId } });
    if (!source?.tunarrChannelId || !source.tunarrChannelName) return;
    const active = await db.job.count({ where: { sourceId: job.sourceId, id: { not: job.id }, type: { in: ["download", "cache", "sync"] }, status: { in: ["queued", "running"] } } });
    if (active) throw new Error("Waiting for source media jobs before refreshing Tunarr.");
    return publishSourceToTunarr(job.sourceId, { channelName: source.tunarrChannelName, channelNumber: source.tunarrRequestedChannelNumber ?? undefined, programmingOrder: source.tunarrProgrammingOrder as PublishTunarrInput["programmingOrder"], prefetch: false });
  }
  throw new Error(`Invalid ${job.type} job payload.`);
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
  await writeLog({ level: "error", category: job.type, sourceId: job.sourceId ?? undefined, videoId: job.videoId ?? undefined, message: `${job.type} job failed: ${message}` });
}

async function work() {
  await recoverJobs();
  for (;;) {
    const job = await claimJob();
    if (!job) return;
    try {
      await handleJob(job);
      if (RATE_LIMITED_JOB_TYPES.includes(job.type)) globalWorker.ytarrRateLimitHits = 0;
      await db.job.update({ where: { id: job.id }, data: { status: "complete", finishedAt: new Date() } }).catch(() => undefined);
      if (["download", "cache", "retag"].includes(job.type) && job.sourceId) {
        const linked = await db.source.findUnique({ where: { id: job.sourceId }, select: { tunarrChannelId: true } });
        if (linked?.tunarrChannelId) {
          if (job.type === "cache" && job.videoId) await materializeForTunarr(job.sourceId, job.videoId);
          await enqueueUniqueJob("tunarr_refresh", job.sourceId);
        }
      }
    } catch (error) {
      await handleJobFailure(job, error);
    }
  }
}

export function kickWorker() {
  if (globalWorker.ytarrWakeTimer) { clearTimeout(globalWorker.ytarrWakeTimer); globalWorker.ytarrWakeTimer = undefined; }
  if (!globalWorker.ytarrWorker) {
    globalWorker.ytarrWorker = work().finally(async () => {
      globalWorker.ytarrWorker = undefined;
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
