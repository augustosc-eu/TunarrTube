import { access } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { kickWorker } from "@/lib/jobs/runner";
import { enqueueSync } from "@/lib/sources/service";
import { createTestDatabase } from "./support/test-database";

// Test runs used to share prisma/tunarrtube.test.db, which was migrated but never emptied. Jobs left
// queued by an earlier run were then claimed by whichever later test kicked the real worker, which ran
// them for real (yt-dlp, MusicBrainz) and pushed unrelated tests past their timeouts.
describe("test run isolation", () => {
  it("never carries a queued job from one run's database into the next", async () => {
    const first = await createTestDatabase();
    const sqlite = new DatabaseSync(first.file);
    try {
      sqlite.prepare("INSERT INTO Job (id, type, status, activeKey, updatedAt) VALUES ('stale-job', 'metadata', 'queued', 'stale', CURRENT_TIMESTAMP)").run();
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM Job").get()).toMatchObject({ n: 1 });
    } finally {
      sqlite.close();
    }
    await first.dispose();
    await expect(access(first.file)).rejects.toThrow();

    const second = await createTestDatabase();
    const fresh = new DatabaseSync(second.file, { readOnly: true });
    try {
      expect(second.file).not.toBe(first.file);
      expect(fresh.prepare("SELECT COUNT(*) AS n FROM Job").get()).toMatchObject({ n: 0 });
    } finally {
      fresh.close();
      await second.dispose();
    }
  });

  it("runs against this run's temporary database, never a file under prisma/", () => {
    const url = process.env.DATABASE_URL ?? "";
    expect(url.startsWith("file:")).toBe(true);
    expect(path.isAbsolute(url.slice(5))).toBe(true);
    expect(url).not.toContain(`${path.sep}prisma${path.sep}`);
  });

  it("leaves enqueued work queued instead of handing it to the real background worker", async () => {
    // enqueueSync reaches kickWorker through `await import("@/lib/jobs/runner")` -- the path a file-level
    // vi.mock of the runner never covered, which used to start real worker lanes from these tests.
    // resetAllMocks first: a test file resetting its own mocks must not switch the real worker back on.
    vi.resetAllMocks();
    expect(kickWorker.name).toBe("inertKickWorker");
    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({
      data: { name: "Isolation test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `test-${suffix}`, mediaDirectory: `/nonexistent/${suffix}` }
    });
    try {
      const job = await enqueueSync(source.id);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((globalThis as { tunarrtubeLanes?: Map<string, unknown> }).tunarrtubeLanes?.size ?? 0).toBe(0);
      expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("queued");
    } finally {
      await db.source.delete({ where: { id: source.id } });
    }
  });

  it("refuses real outbound HTTP unless a test stubs fetch", async () => {
    await expect(fetch("https://musicbrainz.org/ws/2/recording")).rejects.toThrow(/network access is disabled/);
  });
});
