import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertWithinDirectory, isAbsoluteTunarrPath, removeWithinDirectory, translatePathWithMappings } from "@/lib/settings/service";
import { slugify } from "@/lib/sources/service";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("media paths", () => {
  it("creates stable safe source slugs", () => expect(slugify(" Japanese TV / 90's! ")).toBe("japanese-tv-90-s"));

  it("allows children and rejects path escapes", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-test-")); temporary.push(base);
    await mkdir(path.join(base, "source"));
    await expect(assertWithinDirectory(base, path.join(base, "source", "abc.mp4"))).resolves.toContain("abc.mp4");
    await expect(assertWithinDirectory(base, path.join(base, "..", "escape.mp4"))).rejects.toThrow(/outside/);
  });

  it("uses the longest component-safe Tunarr path mapping", () => {
    const mappings = [{ tunarrtubePrefix: "/media", tunarrPrefix: "/data" }, { tunarrtubePrefix: "/media/youtube", tunarrPrefix: "/library/youtube" }];
    expect(translatePathWithMappings("/media/youtube/news/video.mp4", mappings)).toBe("/library/youtube/news/video.mp4");
    expect(() => translatePathWithMappings("/media-other/video.mp4", mappings)).toThrow(/No Tunarr path mapping/);
  });

  it("translates a container path to an absolute Windows Tunarr path", () => {
    const mappings = [{ tunarrtubePrefix: "/media", tunarrPrefix: "D:\\Tunarr Media" }];
    expect(isAbsoluteTunarrPath(mappings[0].tunarrPrefix)).toBe(true);
    expect(isAbsoluteTunarrPath("relative\\media")).toBe(false);
    expect(translatePathWithMappings("/media/news/video.mp4", mappings)).toBe("D:\\Tunarr Media\\news\\video.mp4");
  });

  it("deletes only files inside the expected root", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-test-")); temporary.push(base);
    const outside = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-outside-")); temporary.push(outside);
    await mkdir(path.join(base, "source"));
    const inside = path.join(base, "source", "abc.mp4");
    const elsewhere = path.join(outside, "keep.mp4");
    await writeFile(inside, "x");
    await writeFile(elsewhere, "x");
    await expect(removeWithinDirectory(base, inside)).resolves.toBe(true);
    await expect(access(inside)).rejects.toThrow();
    await expect(removeWithinDirectory(base, elsewhere)).resolves.toBe(false);
    await expect(access(elsewhere)).resolves.toBeUndefined();
    await expect(removeWithinDirectory(base, path.join(base, "gone", "missing.mp4"))).resolves.toBe(false);
    await expect(removeWithinDirectory(base, null)).resolves.toBe(false);
  });

  it("tries each candidate root in turn", async () => {
    const first = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-test-")); temporary.push(first);
    const second = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-test-")); temporary.push(second);
    const file = path.join(second, "abc.mp4");
    await writeFile(file, "x");
    await expect(removeWithinDirectory([first, second], file)).resolves.toBe(true);
    await expect(access(file)).rejects.toThrow();
  });
});
