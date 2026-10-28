import { enforceCachePolicy, reconcileCacheFiles } from "@/lib/cache/service";
import { db } from "@/lib/db/client";
import { purgeLogs, sanitizeLogValue, writeLog } from "@/lib/logging/service";
import { getSettings } from "@/lib/settings/service";
import { enqueueSync, enqueueUniqueJob } from "@/lib/sources/service";

const globalScheduler = globalThis as unknown as { tunarrtubeSchedulerTimer?: NodeJS.Timeout; tunarrtubeCacheTimer?: NodeJS.Timeout; tunarrtubeLogPurgeTimer?: NodeJS.Timeout; tunarrtubeSchedulerStartedAt?: Date; tunarrtubeSchedulerRunning?: boolean; tunarrtubeAvailabilityBackfillStarted?: boolean };

async function runLogPurge() {
  const settings = await getSettings();
  return purgeLogs(settings.logRetentionDays);
}

// Every scheduled task runs unawaited off a timer, so a failure has nowhere to go but here: logged
// (sanitized) instead of becoming an unhandled rejection, and never allowed to stop later ticks. A source
// deleted mid-tick can't be linked (LogEntry.sourceId is a foreign key), so retry unlinked; if logging
// itself fails (e.g. the database is what's broken), fall back to the server console.
async function logSchedulerFailure(task: string, error: unknown, sourceId?: string) {
  const message = `${task} failed: ${sanitizeLogValue(error instanceof Error ? error.message : String(error))}`;
  for (const linkedSourceId of sourceId ? [sourceId, undefined] : [undefined]) {
    try {
      await writeLog({ level: "error", category: "scheduler", sourceId: linkedSourceId, message });
      return;
    } catch {
      // try the next, less specific form
    }
  }
  console.error(message);
}

function runScheduled(task: string, work: () => Promise<unknown>) {
  void work().catch((error) => logSchedulerFailure(task, error));
}

export async function queueAvailabilityReasonBackfill() {
  if (globalScheduler.tunarrtubeAvailabilityBackfillStarted) return 0;
  globalScheduler.tunarrtubeAvailabilityBackfillStarted = true;
  const videos = await db.video.findMany({ where: { availability: "unavailable", availabilityReason: null }, select: { id: true } });
  for (const video of videos) await enqueueUniqueJob("metadata", undefined, video.id);
  if (videos.length) {
    const { kickWorker } = await import("@/lib/jobs/runner");
    kickWorker();
  }
  return videos.length;
}

export async function runDueSyncs(now = new Date()) {
  if (globalScheduler.tunarrtubeSchedulerRunning) return 0;
  globalScheduler.tunarrtubeSchedulerRunning = true;
  try {
    const due = await db.source.findMany({ where: { syncEnabled: true, OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: now } }] }, select: { id: true, syncIntervalMinutes: true } });
    for (const source of due) {
      // One source failing (deleted mid-tick, a constraint error) must not hold back the rest of this
      // tick's due sources; it's logged and tried again the next time it comes due.
      try {
        await db.source.update({ where: { id: source.id }, data: { nextSyncAt: new Date(now.getTime() + source.syncIntervalMinutes * 60_000), lastSyncStatus: "queued" } });
        await enqueueSync(source.id);
      } catch (error) {
        await logSchedulerFailure(`Scheduled sync for source ${source.id}`, error, source.id);
      }
    }
    return due.length;
  } finally { globalScheduler.tunarrtubeSchedulerRunning = false; }
}

export function startScheduler() {
  if (globalScheduler.tunarrtubeSchedulerTimer) return;
  globalScheduler.tunarrtubeSchedulerStartedAt = new Date();
  runScheduled("Scheduled sync check", () => runDueSyncs());
  runScheduled("Unavailable-video reason backfill", queueAvailabilityReasonBackfill);
  runScheduled("Startup cache reconciliation", () => reconcileCacheFiles().then(() => enforceCachePolicy()));
  runScheduled("Log purge", runLogPurge);
  // The kickWorker() here is a safety net, not the primary trigger: enqueues and the runner's own wake
  // timer normally start lanes promptly, but if that timer couldn't be set (e.g. a transient DB error),
  // queued work still starts within a minute. Lanes already running are left alone.
  globalScheduler.tunarrtubeSchedulerTimer = setInterval(() => {
    runScheduled("Scheduled sync check", () => runDueSyncs());
    runScheduled("Job worker wake-up", () => import("@/lib/jobs/runner").then(({ kickWorker }) => kickWorker()));
  }, 60_000);
  globalScheduler.tunarrtubeCacheTimer = setInterval(() => runScheduled("Hourly cache cleanup", () => enforceCachePolicy()), 60 * 60_000);
  globalScheduler.tunarrtubeLogPurgeTimer = setInterval(() => runScheduled("Log purge", runLogPurge), 60 * 60_000);
  globalScheduler.tunarrtubeSchedulerTimer.unref();
  globalScheduler.tunarrtubeCacheTimer.unref();
  globalScheduler.tunarrtubeLogPurgeTimer.unref();
}

export function schedulerStatus() {
  return { started: Boolean(globalScheduler.tunarrtubeSchedulerStartedAt), startedAt: globalScheduler.tunarrtubeSchedulerStartedAt ?? null, running: Boolean(globalScheduler.tunarrtubeSchedulerRunning) };
}
