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
    // Vitest's default pool runs test files in parallel worker processes, each opening its own
    // PrismaClient against this one SQLite file. Against prisma/ytarr.db that mostly went unnoticed
    // (a much larger, already-warm file); a small dedicated file makes the resulting writer-lock
    // contention land squarely inside individual tests' 5s timeout instead. Serializing files trades
    // wall-clock time for a suite that doesn't flake under a fresh test database.
    fileParallelism: false
  }
});
