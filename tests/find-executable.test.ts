import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findOnPath } from "@/lib/system/find-executable";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempDir() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-path-test-"));
  cleanup.push(directory);
  return directory;
}

describe("findOnPath", () => {
  it.skipIf(process.platform === "win32")("returns the first executable match in PATH order, skipping non-executables and directories", async () => {
    const [first, second, third] = await Promise.all([tempDir(), tempDir(), tempDir()]);
    await writeFile(path.join(first, "yt-dlp"), "not executable");
    await mkdir(path.join(second, "yt-dlp"));
    await writeFile(path.join(third, "yt-dlp"), "#!/bin/sh\n");
    await chmod(path.join(third, "yt-dlp"), 0o755);
    expect(await findOnPath("yt-dlp", { PATH: [first, second, third].join(path.delimiter) })).toBe(path.join(third, "yt-dlp"));
  });

  it("returns null when nothing matches or PATH is empty", async () => {
    expect(await findOnPath("tunarrtube-no-such-binary", { PATH: await tempDir() })).toBeNull();
    expect(await findOnPath("yt-dlp", {})).toBeNull();
  });

  it.runIf(process.platform === "win32")("on Windows, finds name.exe through a case-insensitive Path key but never a .cmd shim", async () => {
    const [shims, binaries] = await Promise.all([tempDir(), tempDir()]);
    await writeFile(path.join(shims, "claude.cmd"), "@echo off\r\n");
    await writeFile(path.join(binaries, "claude.exe"), "");
    expect(await findOnPath("claude", { Path: `"${shims}";${binaries}` })).toBe(path.join(binaries, "claude.exe"));
    expect(await findOnPath("claude", { Path: shims })).toBeNull();
  });
});
