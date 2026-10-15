import { enforceCachePolicy, reconcileCacheFiles } from "@/lib/cache/service";
import { db } from "@/lib/db/client";
import { purgeLogs } from "@/lib/logging/service";
import { getSettings } from "@/lib/settings/service";
import { enqueueSync, enqueueUniqueJob } from "@/lib/sources/service";

const globalScheduler = globalThis as unknown as { tunarrtubeSchedulerTimer?: NodeJS.Timeout; tunarrtubeCacheTimer?: NodeJS.Timeout; tunarrtubeLogPurgeTimer?: NodeJS.Timeout; tunarrtubeSchedulerStartedAt?: Date; tunarrtubeSchedulerRunning?: boolean; tunarrtubeAvailabilityBackfillStarted?: boolean };

async function runLogPurge() {
  const settings = await getSettings();
  return purgeLogs(settings.logRetentionDays);
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
      await db.source.update({ where: { id: source.id }, data: { nextSyncAt: new Date(now.getTime() + source.syncIntervalMinutes * 60_000), lastSyncStatus: "queued" } });
      await enqueueSync(source.id);
    }
    return due.length;
  } finally { globalScheduler.tunarrtubeSchedulerRunning = false; }
}

export function startScheduler() {
  if (globalScheduler.tunarrtubeSchedulerTimer) return;
  globalScheduler.tunarrtubeSchedulerStartedAt = new Date();
  void runDueSyncs();
  void queueAvailabilityReasonBackfill().catch(() => undefined);
  void reconcileCacheFiles().then(() => enforceCachePolicy()).catch(() => undefined);
  void runLogPurge().catch(() => undefined);
  // The kickWorker() here is a safety net, not the primary trigger: enqueues and the runner's own wake
  // timer normally start lanes promptly, but if that timer couldn't be set (e.g. a transient DB error),
  // queued work still starts within a minute. Lanes already running are left alone.
  globalScheduler.tunarrtubeSchedulerTimer = setInterval(() => {
    void runDueSyncs();
    void import("@/lib/jobs/runner").then(({ kickWorker }) => kickWorker()).catch(() => undefined);
  }, 60_000);
  globalScheduler.tunarrtubeCacheTimer = setInterval(() => void enforceCachePolicy(), 60 * 60_000);
  globalScheduler.tunarrtubeLogPurgeTimer = setInterval(() => void runLogPurge().catch(() => undefined), 60 * 60_000);
  globalScheduler.tunarrtubeSchedulerTimer.unref();
  globalScheduler.tunarrtubeCacheTimer.unref();
  globalScheduler.tunarrtubeLogPurgeTimer.unref();
}

export function schedulerStatus() {
  return { started: Boolean(globalScheduler.tunarrtubeSchedulerStartedAt), startedAt: globalScheduler.tunarrtubeSchedulerStartedAt ?? null, running: Boolean(globalScheduler.tunarrtubeSchedulerRunning) };
}
