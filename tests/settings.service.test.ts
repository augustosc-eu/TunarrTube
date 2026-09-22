import { describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { getSettings } from "@/lib/settings/service";

// AppSettings is a singleton row (id: 1) shared across this test run -- same convention as
// tests/ai.settings.test.ts's withAiClaudeCodeSettings: capture the row beforehand, delete it to force
// getSettings()'s initial-create path, then restore the captured row afterward so later test files still
// see whatever settings they expect.
async function withNoAppSettingsRow(run: () => Promise<void>) {
  const before = await getSettings();
  await db.appSettings.delete({ where: { id: 1 } });
  try {
    await run();
  } finally {
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...data } = before;
    await db.appSettings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  }
}

describe("getSettings -- concurrent initialization", () => {
  it("creates exactly one AppSettings row when many callers race to initialize it, and every caller gets valid settings", async () => {
    await withNoAppSettingsRow(async () => {
      const results = await Promise.all(Array.from({ length: 10 }, () => getSettings()));

      const rows = await db.appSettings.findMany({ where: { id: 1 } });
      expect(rows).toHaveLength(1);

      for (const settings of results) {
        expect(settings.id).toBe(1);
        expect(settings.mediaBaseDirectory).toBe(rows[0].mediaBaseDirectory);
        expect(settings.tunarrUrl).toBe(rows[0].tunarrUrl);
      }
    });
  });

  it("never overwrites an already-initialized row, even when callers race after it exists", async () => {
    const existing = await getSettings();
    const customEmail = `race-test-${Date.now()}@example.com`;
    await db.appSettings.update({ where: { id: 1 }, data: { musicbrainzContactEmail: customEmail } });
    try {
      const results = await Promise.all(Array.from({ length: 10 }, () => getSettings()));
      for (const settings of results) {
        expect(settings.musicbrainzContactEmail).toBe(customEmail);
      }
      const rows = await db.appSettings.findMany({ where: { id: 1 } });
      expect(rows).toHaveLength(1);
    } finally {
      await db.appSettings.update({ where: { id: 1 }, data: { musicbrainzContactEmail: existing.musicbrainzContactEmail } });
    }
  });
});
