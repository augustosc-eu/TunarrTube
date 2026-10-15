import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ mediaBaseDirectory: "" }));
vi.mock("@/lib/settings/service", () => ({ getSettings: async () => settings }));

import { CACHE_DIRECTORY_NAME } from "@/lib/constants";
import { db } from "@/lib/db/client";
import { LEGACY_CACHE_DIRECTORY_NAME, LEGACY_TEMP_DIRECTORY_NAME, migrateLegacyStorageNames } from "@/lib/maintenance/legacy-names";
import { migrateLegacyDatabase } from "../scripts/migrate-legacy-database.mjs";

const temporary: string[] = [];
const videoIds: string[] = [];
afterEach(async () => {
  if (videoIds.length) await db.video.deleteMany({ where: { id: { in: videoIds.splice(0) } } });
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempDir(prefix: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

const exists = (target: string) => access(target).then(() => true, () => false);

describe("legacy database file", () => {
  it("renames ytarr.db and its SQLite side files to the new default name", async () => {
    const directory = await tempDir("tunarrtube-db-");
    await writeFile(path.join(directory, "ytarr.db"), "data");
    await writeFile(path.join(directory, "ytarr.db-wal"), "wal");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(migrateLegacyDatabase(path.join(directory, "tunarrtube.db"))).toBe(true);
    expect(await readFile(path.join(directory, "tunarrtube.db"), "utf8")).toBe("data");
    expect(await readFile(path.join(directory, "tunarrtube.db-wal"), "utf8")).toBe("wal");
    expect(await exists(path.join(directory, "ytarr.db"))).toBe(false);
    vi.restoreAllMocks();
  });

  it("replaces an empty placeholder but never a real database", async () => {
    const directory = await tempDir("tunarrtube-db-");
    await writeFile(path.join(directory, "ytarr.db"), "legacy");
    await writeFile(path.join(directory, "tunarrtube.db"), "");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(migrateLegacyDatabase(path.join(directory, "tunarrtube.db"))).toBe(true);
    expect(await readFile(path.join(directory, "tunarrtube.db"), "utf8")).toBe("legacy");
    vi.restoreAllMocks();

    await writeFile(path.join(directory, "ytarr.db"), "older");
    expect(migrateLegacyDatabase(path.join(directory, "tunarrtube.db"))).toBe(false);
    expect(await readFile(path.join(directory, "tunarrtube.db"), "utf8")).toBe("legacy");
  });

  it("leaves an explicitly configured database name alone", async () => {
    const directory = await tempDir("tunarrtube-db-");
    await writeFile(path.join(directory, "ytarr.db"), "data");
    expect(migrateLegacyDatabase(path.join(directory, "ytarr.db"))).toBe(false);
    expect(migrateLegacyDatabase(path.join(directory, "custom.db"))).toBe(false);
    expect(await exists(path.join(directory, "ytarr.db"))).toBe(true);
  });
});

describe("legacy storage folders", () => {
  it("renames the cache folder, rewrites cache rows, and removes legacy temp roots", async () => {
    const base = await tempDir("tunarrtube-media-");
    settings.mediaBaseDirectory = base;
    const legacyVideos = path.join(base, LEGACY_CACHE_DIRECTORY_NAME, "videos");
    await mkdir(path.join(legacyVideos, LEGACY_TEMP_DIRECTORY_NAME, "stale-attempt"), { recursive: true });
    await writeFile(path.join(legacyVideos, "abc.mp4"), "video");

    const youtubeId = `legacy-${Date.now()}`;
    const video = await db.video.create({ data: { youtubeId, title: "Legacy", youtubeUrl: `https://www.youtube.com/watch?v=${youtubeId}` } });
    videoIds.push(video.id);
    const asset = await db.cacheAsset.create({ data: { videoId: video.id, status: "complete", localPath: path.join(legacyVideos, "abc.mp4") } });

    const result = await migrateLegacyStorageNames();
    const newVideos = path.join(base, CACHE_DIRECTORY_NAME, "videos");
    expect(result.movedFolders).toBeGreaterThanOrEqual(1);
    expect(await exists(path.join(base, LEGACY_CACHE_DIRECTORY_NAME))).toBe(false);
    expect(await readFile(path.join(newVideos, "abc.mp4"), "utf8")).toBe("video");
    expect(await exists(path.join(newVideos, LEGACY_TEMP_DIRECTORY_NAME))).toBe(false);
    expect((await db.cacheAsset.findUnique({ where: { id: asset.id } }))?.localPath).toBe(path.join(newVideos, "abc.mp4"));

    // A second run is a no-op.
    const again = await migrateLegacyStorageNames();
    expect(again.movedFolders).toBe(0);
  });

  it("leaves both folders alone when the new one already exists", async () => {
    const base = await tempDir("tunarrtube-media-");
    settings.mediaBaseDirectory = base;
    await mkdir(path.join(base, LEGACY_CACHE_DIRECTORY_NAME, "videos"), { recursive: true });
    await mkdir(path.join(base, CACHE_DIRECTORY_NAME, "videos"), { recursive: true });
    await writeFile(path.join(base, LEGACY_CACHE_DIRECTORY_NAME, "videos", "keep.mp4"), "x");
    const result = await migrateLegacyStorageNames();
    expect(result.movedFolders).toBe(0);
    expect(await exists(path.join(base, LEGACY_CACHE_DIRECTORY_NAME, "videos", "keep.mp4"))).toBe(true);
  });
});
