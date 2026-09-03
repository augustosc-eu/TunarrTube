import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertWithinDirectory } from "@/lib/settings/service";
import { translatePathWithMappings } from "@/lib/settings/service";
import { slugify } from "@/lib/sources/service";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("media paths", () => {
  it("creates stable safe source slugs", () => expect(slugify(" Japanese TV / 90's! ")).toBe("japanese-tv-90-s"));

  it("allows children and rejects path escapes", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "ytarr-test-")); temporary.push(base);
    await mkdir(path.join(base, "source"));
    await expect(assertWithinDirectory(base, path.join(base, "source", "abc.mp4"))).resolves.toContain("abc.mp4");
    await expect(assertWithinDirectory(base, path.join(base, "..", "escape.mp4"))).rejects.toThrow(/outside/);
  });

  it("uses the longest component-safe Tunarr path mapping", () => {
    const mappings = [{ ytarrPrefix: "/media", tunarrPrefix: "/data" }, { ytarrPrefix: "/media/youtube", tunarrPrefix: "/library/youtube" }];
    expect(translatePathWithMappings("/media/youtube/news/video.mp4", mappings)).toBe("/library/youtube/news/video.mp4");
    expect(() => translatePathWithMappings("/media-other/video.mp4", mappings)).toThrow(/No Tunarr path mapping/);
  });
});
