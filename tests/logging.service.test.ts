import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { purgeLogs } from "@/lib/logging/service";

describe("purgeLogs", () => {
  const cleanupLogIds: string[] = [];

  afterEach(async () => {
    await db.logEntry.deleteMany({ where: { id: { in: cleanupLogIds.splice(0) } } });
  });

  async function makeLog(category: string, createdAt: Date) {
    const log = await db.logEntry.create({ data: { category, message: "test entry", createdAt } });
    cleanupLogIds.push(log.id);
    return log;
  }

  // Only exercises the age-based path here: `clear: true` runs an unconditional deleteMany({}) over the
  // whole LogEntry table (by design -- it's the "delete everything" escape hatch), which would wipe out
  // real history in the shared dev database this suite runs against, so it isn't safe to cover here the
  // way the rest of this file scopes its assertions to rows it created itself.
  it("deletes only entries older than the retention window", async () => {
    const old = await makeLog("test-old", new Date(Date.now() - 40 * 86_400_000));
    const recent = await makeLog("test-recent", new Date());

    const result = await purgeLogs(30);
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(result.clear).toBe(false);

    expect(await db.logEntry.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await db.logEntry.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });
});
