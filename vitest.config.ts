import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Dedicated SQLite file (see scripts/prepare-test-db.mjs's "pretest" hook, which migrates it) so
    // integration tests -- real Prisma client, only fetch/child_process stubbed -- never write into the
    // same prisma/ytarr.db the dev server uses. Set here rather than left to lib/db/client.ts's own
    // fallback, since that fallback is literally "file:./ytarr.db", the dev database.
    env: { DATABASE_URL: "file:./ytarr.test.db" },
    // Two independent reasons to serialize test files, not just one: (1) vitest's default pool runs
    // files in parallel worker processes, each opening its own PrismaClient against this one dedicated
    // SQLite file -- small and freshly created, so the resulting writer-lock contention lands squarely
    // inside individual tests' 5s timeout; (2) several integration tests exercise the real, unmocked
    // lib/jobs/runner.ts worker, whose claimJob() scans the whole Job table with no per-test scoping
    // (see tests/rate-limit.integration.test.ts's top-of-file comment) -- running files in parallel lets
    // one file's background worker claim another concurrently-running file's still-in-progress job rows.
    // Serializing removes both races at once; it also matches this app's own single-instance assumption
    // (see AGENTS.md) instead of fighting it. Trades wall-clock time for a suite that doesn't flake.
    fileParallelism: false
  }
});
