import { enforceCachePolicy, reconcileCacheFiles } from "@/lib/cache/service";
import { db } from "@/lib/db/client";
import { purgeLogs } from "@/lib/logging/service";
import { getSettings } from "@/lib/settings/service";
import { enqueueSync, enqueueUniqueJob } from "@/lib/sources/service";

const globalScheduler = globalThis as unknown as { ytarrSchedulerTimer?: NodeJS.Timeout; ytarrCacheTimer?: NodeJS.Timeout; ytarrLogPurgeTimer?: NodeJS.Timeout; ytarrSchedulerStartedAt?: Date; ytarrSchedulerRunning?: boolean; ytarrAvailabilityBackfillStarted?: boolean };

async function runLogPurge() {
  const settings = await getSettings();
  return purgeLogs(settings.logRetentionDays);
}

export async function queueAvailabilityReasonBackfill() {
  if (globalScheduler.ytarrAvailabilityBackfillStarted) return 0;
  globalScheduler.ytarrAvailabilityBackfillStarted = true;
  const videos = await db.video.findMany({ where: { availability: "unavailable", availabilityReason: null }, select: { id: true } });
  for (const video of videos) await enqueueUniqueJob("metadata", undefined, video.id);
  if (videos.length) {
    const { kickWorker } = await import("@/lib/jobs/runner");
    kickWorker();
  }
  return videos.length;
}

export async function runDueSyncs(now = new Date()) {
  if (globalScheduler.ytarrSchedulerRunning) return 0;
  globalScheduler.ytarrSchedulerRunning = true;
  try {
    const due = await db.source.findMany({ where: { syncEnabled: true, OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: now } }] }, select: { id: true, syncIntervalMinutes: true } });
    for (const source of due) {
      await db.source.update({ where: { id: source.id }, data: { nextSyncAt: new Date(now.getTime() + source.syncIntervalMinutes * 60_000), lastSyncStatus: "queued" } });
      await enqueueSync(source.id);
    }
    return due.length;
  } finally { globalScheduler.ytarrSchedulerRunning = false; }
}

export function startScheduler() {
  if (globalScheduler.ytarrSchedulerTimer) return;
  globalScheduler.ytarrSchedulerStartedAt = new Date();
  void runDueSyncs();
  void queueAvailabilityReasonBackfill().catch(() => undefined);
  void reconcileCacheFiles().then(() => enforceCachePolicy()).catch(() => undefined);
  void runLogPurge().catch(() => undefined);
  globalScheduler.ytarrSchedulerTimer = setInterval(() => void runDueSyncs(), 60_000);
  globalScheduler.ytarrCacheTimer = setInterval(() => void enforceCachePolicy(), 60 * 60_000);
  globalScheduler.ytarrLogPurgeTimer = setInterval(() => void runLogPurge().catch(() => undefined), 60 * 60_000);
  globalScheduler.ytarrSchedulerTimer.unref();
  globalScheduler.ytarrCacheTimer.unref();
  globalScheduler.ytarrLogPurgeTimer.unref();
}

export function schedulerStatus() {
  return { started: Boolean(globalScheduler.ytarrSchedulerStartedAt), startedAt: globalScheduler.ytarrSchedulerStartedAt ?? null, running: Boolean(globalScheduler.ytarrSchedulerRunning) };
}
