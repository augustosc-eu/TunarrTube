import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  job: { findMany: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  sourceVideo: { updateMany: vi.fn() },
  cacheAsset: { updateMany: vi.fn() },
  publish: vi.fn(),
  settings: vi.fn(),
  log: vi.fn()
}));
vi.mock("@/lib/db/client", () => ({ db: mocks }));
vi.mock("@/lib/settings/service", () => ({ getSettings: mocks.settings }));
vi.mock("@/lib/tunarr/service", () => ({ publishSourceToTunarr: mocks.publish }));
vi.mock("@/lib/logging/service", () => ({ writeLog: mocks.log, sanitizeLogValue: (s: string) => s }));

import { recoverJobs, kickWorker, requestJobStop, handleJobFailure } from "@/lib/jobs/runner";

const state = globalThis as typeof globalThis & {
  ytarrRecovered?: boolean; ytarrRecovery?: Promise<void>;
  ytarrLanes?: Map<string, Promise<void>>; ytarrControllers?: Map<string, AbortController>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  delete state.ytarrRecovered;
  delete state.ytarrRecovery;
  mocks.job.findMany.mockResolvedValue([]);
  mocks.job.updateMany.mockResolvedValue({ count: 1 });
  mocks.sourceVideo.updateMany.mockResolvedValue({ count: 0 });
  mocks.cacheAsset.updateMany.mockResolvedValue({ count: 0 });
  mocks.log.mockResolvedValue(undefined);
});
afterEach(() => {
  delete state.ytarrRecovered;
  delete state.ytarrRecovery;
  delete state.ytarrLanes;
  delete state.ytarrControllers;
});

describe("job lifecycle", () => {
  it("makes concurrent worker lanes wait until all recovery work finishes", async () => {
    const barrier = deferred<{ count: number }>();
    mocks.cacheAsset.updateMany.mockReturnValue(barrier.promise);
    let finished = 0;
    const calls = [recoverJobs(), recoverJobs(), recoverJobs()].map((p) => p.then(() => finished++));
    await vi.waitFor(() => expect(mocks.cacheAsset.updateMany).toHaveBeenCalledTimes(1));
    expect(finished).toBe(0);
    barrier.resolve({ count: 0 });
    await Promise.all(calls);
    expect(finished).toBe(3);
    expect(mocks.job.findMany).toHaveBeenCalledTimes(1);
  });

  it("allows another recovery pass after a database error", async () => {
    mocks.job.findMany.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(recoverJobs()).rejects.toThrow("database unavailable");
    expect(state.ytarrRecovered).not.toBe(true);
    await recoverJobs();
    expect(state.ytarrRecovered).toBe(true);
  });

  it("fails interrupted jobs at their retry limit and only requeues attempts below it", async () => {
    mocks.job.findMany.mockResolvedValue([
      { id: "exhausted", type: "tunarr_publish", attempts: 7, maxAttempts: 3 },
      { id: "retry", type: "tunarr_publish", attempts: 1, maxAttempts: 3 }
    ]);
    await recoverJobs();
    expect(mocks.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "exhausted", status: "running" },
      data: expect.objectContaining({ status: "failed", finishedAt: expect.any(Date) })
    }));
    expect(mocks.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "retry", status: "running" },
      data: expect.objectContaining({ status: "queued", finishedAt: null })
    }));
  });

  it("clears downloading status when an interrupted media job exhausted its attempts", async () => {
    mocks.job.findMany.mockResolvedValue([
      { id: "download", type: "download", sourceId: "source", videoId: "video", attempts: 3, maxAttempts: 3 },
      { id: "cache", type: "cache", videoId: "cached-video", attempts: 3, maxAttempts: 3 }
    ]);
    await recoverJobs();
    expect(mocks.sourceVideo.updateMany).toHaveBeenCalledWith({
      where: { sourceId: "source", videoId: "video", downloadStatus: "downloading" },
      data: { downloadStatus: "failed" }
    });
    expect(mocks.cacheAsset.updateMany).toHaveBeenCalledWith({
      where: { videoId: "cached-video", status: "downloading" },
      data: { status: "failed", error: expect.stringContaining("retry limit reached") }
    });
  });

  it("does not retry a failure delivered after persistent cancellation", async () => {
    mocks.job.findUnique.mockResolvedValue({ status: "cancelled" });
    await handleJobFailure({ id: "stopped", type: "tunarr_publish" } as Parameters<typeof handleJobFailure>[0], new Error("late failure"));
    expect(mocks.job.updateMany).not.toHaveBeenCalled();
  });

  it("does not complete a stopped publish even when its handler resolves successfully", async () => {
    state.ytarrRecovered = true;
    const job = { id: "publish", type: "tunarr_publish", status: "running", sourceId: "source", payloadJson: "{}" };
    let claimed = false;
    mocks.settings.mockResolvedValue({ jobsPaused: false });
    mocks.job.findFirst.mockImplementation(async ({ where }) => {
      if (!claimed && where.type.notIn) { claimed = true; return job; }
      return null;
    });
    mocks.job.findUnique.mockResolvedValue(job);
    const started = deferred<void>();
    const result = deferred<void>();
    mocks.publish.mockImplementation(() => { started.resolve(); return result.promise; });
    kickWorker();
    const lanes = [...state.ytarrLanes!.values()];
    await started.promise;
    expect(requestJobStop(job.id)).toBe(true);
    mocks.settings.mockResolvedValue({ jobsPaused: true });
    result.resolve();
    await Promise.all(lanes);
    expect(mocks.job.updateMany.mock.calls.some(([arg]) => arg.data.status === "complete")).toBe(false);
    expect(mocks.job.updateMany.mock.calls.some(([arg]) => arg.data.status === "cancelled")).toBe(true);
    expect(state.ytarrControllers!.size).toBe(0);
  });
});
