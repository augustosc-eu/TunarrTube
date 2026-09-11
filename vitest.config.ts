import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one real SQLite file (see scripts/prepare-dev.mjs) and several of them
    // exercise the real, unmocked lib/jobs/runner.ts worker, whose claimJob() scans the whole Job table
    // with no per-test scoping (see tests/rate-limit.integration.test.ts's top-of-file comment). Running
    // test files in parallel worker processes lets one file's background worker claim another
    // concurrently-running file's still-in-progress job rows. Serializing files removes the race; it
    // matches this app's own single-instance assumption (see AGENTS.md) instead of fighting it.
    fileParallelism: false
  }
});
