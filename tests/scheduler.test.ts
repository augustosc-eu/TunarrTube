import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";

const mocks = vi.hoisted(() => ({
  enqueueSync: vi.fn(),
  enforceCachePolicy: vi.fn(),
  reconcileCacheFiles: vi.fn()
}));
vi.mock("@/lib/sources/service", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sources/service")>(),
  enqueueSync: mocks.enqueueSync
}));
vi.mock("@/lib/cache/service", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/cache/service")>(),
  enforceCachePolicy: mocks.enforceCachePolicy,
  reconcileCacheFiles: mocks.reconcileCacheFiles
}));

const { runDueSyncs, startScheduler } = await import("@/lib/jobs/scheduler");

const schedulerState = globalThis as typeof globalThis & {
  tunarrtubeSchedulerTimer?: NodeJS.Timeout; tunarrtubeCacheTimer?: NodeJS.Timeout; tunarrtubeLogPurgeTimer?: NodeJS.Timeout;
  tunarrtubeSchedulerStartedAt?: Date; tunarrtubeAvailabilityBackfillStarted?: boolean;
};
const SECRET_URL = "https://rr1.googlevideo.com/videoplayback?sig=secret-signature";
const createdSourceIds: string[] = [];

async function createDueSource(name: string) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const source = await db.source.create({
    data: {
      name, url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `scheduler-${suffix}`,
      mediaDirectory: `/nonexistent/${suffix}`, syncEnabled: true, nextSyncAt: new Date(Date.now() - 60_000)
    }
  });
  createdSourceIds.push(source.id);
  return source;
}

afterEach(async () => {
  vi.useRealTimers();
  for (const key of ["tunarrtubeSchedulerTimer", "tunarrtubeCacheTimer", "tunarrtubeLogPurgeTimer"] as const) {
    clearInterval(schedulerState[key]);
    delete schedulerState[key];
  }
  delete schedulerState.tunarrtubeSchedulerStartedAt;
  vi.resetAllMocks();
  await db.logEntry.deleteMany({ where: { category: "scheduler" } });
  await db.source.deleteMany({ where: { id: { in: createdSourceIds.splice(0) } } });
});

describe("runDueSyncs", () => {
  it("still queues every other due source when one of them fails, and logs the failure sanitized", async () => {
    const failing = await createDueSource("Failing scheduled source");
    const healthy = await createDueSource("Healthy scheduled source");
    mocks.enqueueSync.mockImplementation(async (sourceId: string) => {
      if (sourceId === failing.id) throw new Error(`database is locked while fetching ${SECRET_URL}`);
      return { id: `job-${sourceId}` };
    });

    await runDueSyncs();

    expect(mocks.enqueueSync).toHaveBeenCalledWith(failing.id);
    expect(mocks.enqueueSync).toHaveBeenCalledWith(healthy.id);
    const [entry] = await db.logEntry.findMany({ where: { category: "scheduler", sourceId: failing.id } });
    expect(entry?.level).toBe("error");
    expect(entry?.message).toContain("[redacted-url]");
    expect(entry?.message).not.toContain("secret-signature");
  });

  it("keeps processing when the failing source was deleted mid-tick, logging without the stale source link", async () => {
    const vanished = await createDueSource("Vanished scheduled source");
    const healthy = await createDueSource("Healthy scheduled source");
    mocks.enqueueSync.mockImplementation(async (sourceId: string) => {
      if (sourceId === vanished.id) {
        await db.source.delete({ where: { id: vanished.id } });
        throw new Error("Source not found.");
      }
      return { id: `job-${sourceId}` };
    });

    await runDueSyncs();

    expect(mocks.enqueueSync).toHaveBeenCalledWith(healthy.id);
    const entries = await db.logEntry.findMany({ where: { category: "scheduler", message: { contains: vanished.id } } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sourceId).toBeNull();
  });
});

describe("startScheduler", () => {
  it("logs a failed hourly cache cleanup without an unhandled rejection, and runs the next one", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    // Only intervals are faked: Prisma's own I/O and promises keep running for real.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    schedulerState.tunarrtubeAvailabilityBackfillStarted = true;
    mocks.enqueueSync.mockResolvedValue({ id: "job" });
    mocks.reconcileCacheFiles.mockResolvedValue(0);
    mocks.enforceCachePolicy
      .mockResolvedValueOnce({ evicted: 0 }) // the startup pass after reconcileCacheFiles
      .mockRejectedValueOnce(new Error(`disk unavailable reading ${SECRET_URL}`))
      .mockResolvedValue({ evicted: 0 });
    try {
      startScheduler();
      await vi.waitFor(() => expect(mocks.enforceCachePolicy).toHaveBeenCalledTimes(1));

      vi.advanceTimersByTime(60 * 60_000);
      await vi.waitFor(async () => {
        const entries = await db.logEntry.findMany({ where: { category: "scheduler", message: { startsWith: "Hourly cache cleanup failed" } } });
        expect(entries).toHaveLength(1);
        expect(entries[0]?.message).toContain("[redacted-url]");
        expect(entries[0]?.message).not.toContain("secret-signature");
      });

      vi.advanceTimersByTime(60 * 60_000);
      await vi.waitFor(() => expect(mocks.enforceCachePolicy).toHaveBeenCalledTimes(3));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      delete schedulerState.tunarrtubeAvailabilityBackfillStarted;
    }
  });
});
