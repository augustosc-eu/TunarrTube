import { beforeEach, inject } from "vitest";

// Runs before each test file's own imports, so lib/db/client.ts opens this run's database
// (tests/support/global-setup.ts) rather than anything under prisma/.
process.env.DATABASE_URL = inject("databaseUrl");

// Services call kickWorker() after enqueueing. In a test that would start the real, table-wide worker
// in the background, which claims whatever other tests queued and runs it for real -- yt-dlp,
// MusicBrainz, iTunes -- racing the tests and their cleanup. A file-level vi.mock of the runner does not
// stop that: services reach it with `await import("@/lib/jobs/runner")`, which resolves to the real
// module. Replacing the export on the module namespace does, since every importer reads kickWorker from
// it at call time. A plain replacement rather than a vi.spyOn mock, so vi.resetAllMocks()/
// restoreAllMocks() in a test file can't quietly switch the real worker back on. Imported lazily so
// each test file's own vi.mock calls are registered first. A file that drives the worker loop itself
// sets globalThis.tunarrtubeTestRealWorker at its top level (see tests/jobs.lifecycle.test.ts).
export function inertKickWorker() {}

// The first import in each file loads the runner's whole module graph (Prisma, both AI SDKs, ...), which
// on a slow or busy disk can take well over the default 10s hook timeout; later calls hit the cache.
const FIRST_RUNNER_IMPORT_TIMEOUT_MS = 120_000;

beforeEach(async () => {
  if ((globalThis as { tunarrtubeTestRealWorker?: boolean }).tunarrtubeTestRealWorker) return;
  const runner = await import("@/lib/jobs/runner");
  if (runner.kickWorker !== inertKickWorker) {
    Object.defineProperty(runner, "kickWorker", { value: inertKickWorker, configurable: true, enumerable: true, writable: true });
  }
}, FIRST_RUNNER_IMPORT_TIMEOUT_MS);

// Outbound HTTP is never part of a test: tests that need fetch stub it with vi.stubGlobal, and
// vi.unstubAllGlobals() restores this guard rather than the real fetch.
globalThis.fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input);
  throw new Error(`Real network access is disabled in tests (fetch ${url}). Stub fetch with vi.stubGlobal.`);
};
