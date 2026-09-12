type Waiter = {
  resolve: (release: () => void) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

type DownloadLimiterState = { active: number; waiters: Waiter[] };

const globalLimiter = globalThis as typeof globalThis & { ytarrDownloadLimiter?: DownloadLimiterState };
const configuredConcurrency = Number.parseInt(process.env.TUNARRTUBE_DOWNLOAD_CONCURRENCY ?? "1", 10);

export const DOWNLOAD_CONCURRENCY = Number.isSafeInteger(configuredConcurrency) && configuredConcurrency > 0
  ? configuredConcurrency
  : 1;

function state() {
  return (globalLimiter.ytarrDownloadLimiter ??= { active: 0, waiters: [] });
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function releasePermit() {
  const limiter = state();
  limiter.active = Math.max(0, limiter.active - 1);
  while (limiter.waiters.length) {
    const waiter = limiter.waiters.shift()!;
    if (waiter.signal?.aborted) continue;
    if (waiter.onAbort) waiter.signal?.removeEventListener("abort", waiter.onAbort);
    limiter.active += 1;
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      releasePermit();
    });
    break;
  }
}

async function acquirePermit(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const limiter = state();
  if (limiter.active < DOWNLOAD_CONCURRENCY) {
    limiter.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releasePermit();
    };
  }

  return new Promise<() => void>((resolve, reject) => {
    const waiter: Waiter = { resolve, reject, signal };
    if (signal) {
      waiter.onAbort = () => {
        const index = limiter.waiters.indexOf(waiter);
        if (index >= 0) limiter.waiters.splice(index, 1);
        reject(abortReason(signal));
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
    }
    limiter.waiters.push(waiter);
  });
}

export async function withDownloadPermit<T>(work: () => Promise<T>, signal?: AbortSignal) {
  const release = await acquirePermit(signal);
  try {
    signal?.throwIfAborted();
    return await work();
  } finally {
    release();
  }
}
