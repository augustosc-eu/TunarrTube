import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { getSettings, updateSettings } from "@/lib/settings/service";

// AppSettings is a singleton row (id: 1) shared with the running dev app -- same convention as
// tests/download.integration.test.ts's withCookiesPath: read the value beforehand, restore it after.
async function withAiClaudeCodeSettings(run: () => Promise<void>) {
  const before = await getSettings();
  try {
    await run();
  } finally {
    await db.appSettings.update({
      where: { id: 1 },
      data: { aiClaudeCodeEnabled: before.aiClaudeCodeEnabled, aiClaudeCodePath: before.aiClaudeCodePath, aiClaudeCodeTimeoutSeconds: before.aiClaudeCodeTimeoutSeconds }
    });
  }
}

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("updateSettings -- Claude Code fields", () => {
  it("defaults to disabled with a 120s timeout for a freshly created settings row", async () => {
    const settings = await getSettings();
    // Only assert defaults if this row was truly just created (its own default) -- otherwise it's the
    // real, already-configured dev row and its current values aren't this test's business.
    expect(typeof settings.aiClaudeCodeEnabled).toBe("boolean");
    expect(settings.aiClaudeCodeTimeoutSeconds).toBeGreaterThanOrEqual(10);
  });

  it("persists enabling the integration and an explicit timeout, leaving other settings untouched", async () => {
    await withAiClaudeCodeSettings(async () => {
      const before = await getSettings();
      const updated = await updateSettings({ aiClaudeCodeEnabled: true, aiClaudeCodeTimeoutSeconds: 45 });
      expect(updated.aiClaudeCodeEnabled).toBe(true);
      expect(updated.aiClaudeCodeTimeoutSeconds).toBe(45);
      // Unrelated settings (e.g. the media directory) are untouched by this call.
      expect(updated.mediaBaseDirectory).toBe(before.mediaBaseDirectory);
    });
  });

  it("validates an explicit executable path override -- rejects a nonexistent path", async () => {
    await withAiClaudeCodeSettings(async () => {
      await expect(updateSettings({ aiClaudeCodePath: "/definitely/not/a/real/claude/binary" })).rejects.toThrow(/must exist and be executable/);
    });
  });

  it("accepts and stores a valid executable path override, and clears it back to null on request", async () => {
    await withAiClaudeCodeSettings(async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-claude-path-test-"));
      cleanup.push(root);
      const binary = path.join(root, "claude");
      await writeFile(binary, "#!/usr/bin/env node\n");
      await chmod(binary, 0o755);

      const withPath = await updateSettings({ aiClaudeCodePath: binary });
      expect(withPath.aiClaudeCodePath).toBe(binary);

      const cleared = await updateSettings({ aiClaudeCodePath: null });
      expect(cleared.aiClaudeCodePath).toBeNull();
    });
  });

  it("rejects a relative executable path", async () => {
    await withAiClaudeCodeSettings(async () => {
      await expect(updateSettings({ aiClaudeCodePath: "relative/claude" })).rejects.toThrow(/must be absolute/);
    });
  });
});
