import os from "node:os";
import path from "node:path";
import { chmod, mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { completeSetup, getSettings, isSetupComplete } from "@/lib/settings/service";
import { browseDirectory, createDirectory } from "@/lib/settings/storage";

let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "tunarrtube-storage-")));
  await mkdir(path.join(root, "Movies"));
  await mkdir(path.join(root, "anime"));
  await mkdir(path.join(root, ".hidden"));
  await writeFile(path.join(root, "cookies.txt"), "# Netscape HTTP Cookie File\n");
  await writeFile(path.join(root, "notes.md"), "");
  await writeFile(path.join(root, ".hidden-cookies.txt"), "");
  await writeFile(path.join(root, "claude"), "#!/bin/sh\n");
  await chmod(path.join(root, "claude"), 0o755);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("browseDirectory", () => {
  it("lists visible subdirectories sorted case-insensitively, with parent, writability, and disk space", async () => {
    const listing = await browseDirectory(root);
    expect(listing.path).toBe(root);
    expect(listing.parent).toBe(path.dirname(root));
    expect(listing.writable).toBe(true);
    expect(listing.directories.map((directory) => directory.name)).toEqual(["anime", "Movies"]);
    expect(listing.freeBytes).toBeGreaterThan(0);
    expect(listing.roots.length).toBeGreaterThan(0);
  });

  it("lists no files unless a file kind is requested", async () => {
    const listing = await browseDirectory(root);
    expect(listing).not.toHaveProperty("files");
  });

  it("lists visible .txt files for the cookies kind", async () => {
    const listing = await browseDirectory(root, null, "cookies");
    expect(listing.files?.map((file) => file.name)).toEqual(["cookies.txt"]);
    expect(listing.files?.[0].path).toBe(path.join(root, "cookies.txt"));
  });

  it.skipIf(process.platform === "win32")("lists files with the execute bit for the executable kind", async () => {
    const listing = await browseDirectory(root, null, "executable");
    expect(listing.files?.map((file) => file.name)).toEqual(["claude"]);
  });

  it("opens a file's containing folder only when a file kind is requested", async () => {
    const listing = await browseDirectory(path.join(root, "cookies.txt"), null, "cookies");
    expect(listing.path).toBe(root);
    await expect(browseDirectory(path.join(root, "cookies.txt"))).rejects.toMatchObject({ code: "NOT_A_DIRECTORY" });
  });

  it("rejects relative and missing paths", async () => {
    await expect(browseDirectory("relative/path")).rejects.toMatchObject({ code: "INVALID_DIRECTORY" });
    await expect(browseDirectory(path.join(root, "nope"))).rejects.toMatchObject({ code: "DIRECTORY_NOT_FOUND" });
  });
});

describe("createDirectory", () => {
  it("creates a single folder inside the parent", async () => {
    const created = await createDirectory(root, "New Media");
    expect(created.path).toBe(path.join(root, "New Media"));
    expect((await stat(created.path)).isDirectory()).toBe(true);
  });

  it.each(["..", ".", "a/b", "..\\x", "  "])("rejects the name %j", async (name) => {
    await expect(createDirectory(root, name)).rejects.toBeInstanceOf(AppError);
  });
});

describe("completeSetup", () => {
  it("saves the chosen media directory and Tunarr URL and marks setup complete", async () => {
    const before = await getSettings();
    try {
      await db.appSettings.update({ where: { id: 1 }, data: { setupCompletedAt: null } });
      expect(await isSetupComplete()).toBe(false);

      const target = path.join(root, "library");
      const saved = await completeSetup({ mediaBaseDirectory: target, tunarrUrl: "http://tunarr.local:8000/" });

      expect(saved.mediaBaseDirectory).toBe(target);
      expect(saved.tunarrUrl).toBe("http://tunarr.local:8000");
      expect(saved.setupCompletedAt).toBeInstanceOf(Date);
      expect(await isSetupComplete()).toBe(true);
    } finally {
      await db.appSettings.update({ where: { id: 1 }, data: { mediaBaseDirectory: before.mediaBaseDirectory, tunarrUrl: before.tunarrUrl, setupCompletedAt: before.setupCompletedAt } });
    }
  });

  it("leaves setup incomplete when the media directory is invalid", async () => {
    const before = await getSettings();
    try {
      await db.appSettings.update({ where: { id: 1 }, data: { setupCompletedAt: null } });
      await expect(completeSetup({ mediaBaseDirectory: "not/absolute", tunarrUrl: "http://127.0.0.1:8000" })).rejects.toMatchObject({ code: "INVALID_MEDIA_DIRECTORY" });
      expect(await isSetupComplete()).toBe(false);
    } finally {
      await db.appSettings.update({ where: { id: 1 }, data: { setupCompletedAt: before.setupCompletedAt } });
    }
  });
});
