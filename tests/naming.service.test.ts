import { describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { assignEpisodeNumber, extractVideoId, fillNamingTemplate, resolveVideoPaths, sanitizeFilenameComponent } from "@/lib/naming/service";

describe("sanitizeFilenameComponent", () => {
  it("strips illegal filesystem characters", () => {
    expect(sanitizeFilenameComponent('a/b\\c:d*e?f"g<h>i|j', "fallback")).toBe("a b c d e f g h i j");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeFilenameComponent("  too   much   space  ", "fallback")).toBe("too much space");
  });

  it("trims trailing dots and spaces (Windows/NTFS safety)", () => {
    expect(sanitizeFilenameComponent("Title.. ", "fallback")).toBe("Title");
  });

  it("falls back on an empty result", () => {
    expect(sanitizeFilenameComponent("   ", "fallback")).toBe("fallback");
    expect(sanitizeFilenameComponent("///", "fallback")).toBe("fallback");
  });

  it("falls back on a Windows-reserved device name", () => {
    expect(sanitizeFilenameComponent("CON", "fallback")).toBe("fallback");
    expect(sanitizeFilenameComponent("com3", "fallback")).toBe("fallback");
  });

  it("caps very long values", () => {
    const long = "x".repeat(500);
    expect(sanitizeFilenameComponent(long, "fallback").length).toBeLessThanOrEqual(150);
  });

  it("preserves unicode titles", () => {
    expect(sanitizeFilenameComponent("日本語のタイトル", "fallback")).toBe("日本語のタイトル");
  });
});

describe("fillNamingTemplate", () => {
  const vars = { title: "My Video", channel: "My Channel", date: "2026-01-02", year: "2026", videoId: "abc123XYZ_-" };

  it("substitutes known tokens", () => {
    expect(fillNamingTemplate("{channel} - {title}", vars)).toBe("My Channel - My Video");
    expect(fillNamingTemplate("{title}", vars)).toBe("My Video");
    expect(fillNamingTemplate("{date} - {title}", vars)).toBe("2026-01-02 - My Video");
  });

  it("resolves unknown tokens to empty string", () => {
    expect(fillNamingTemplate("{title} ({nonsense})", vars)).toBe("My Video ()");
  });

  it("sanitizes a value that would otherwise inject a path separator", () => {
    expect(fillNamingTemplate("{title}", { ...vars, title: "a/b" })).toBe("a b");
  });

  it("preserves a literal '/' in the template itself so it can express a subfolder", () => {
    expect(fillNamingTemplate("{channel}/{title}", vars)).toBe("My Channel/My Video");
  });
});

describe("resolveVideoPaths", () => {
  const source = { name: "My Channel" };
  const video = { youtubeId: "abc123XYZ_-", title: "My Video", uploadDate: new Date("2026-01-02T00:00:00Z") };

  it("keeps the 'id' scheme identical to today's flat <youtubeId>.mp4 behavior", () => {
    const result = resolveVideoPaths({ mediaDirectory: "/media/src", scheme: "id", template: "{title}", source, video });
    expect(result).toMatchObject({ directory: "/media/src", basename: "abc123XYZ_-", posterSuffix: "-poster", sidecarExtension: ".json", showNfoPath: null });
  });

  it("fills a flat 'template' scheme and appends the videoId when missing", () => {
    const result = resolveVideoPaths({ mediaDirectory: "/media/src", scheme: "template", template: "{channel} - {title}", source, video });
    expect(result.directory).toBe("/media/src");
    expect(result.basename).toBe("My Channel - My Video [abc123XYZ_-]");
    expect(result.posterSuffix).toBe("-poster");
    expect(result.sidecarExtension).toBe(".json");
  });

  it("doesn't double up the videoId when the template already includes it", () => {
    const result = resolveVideoPaths({ mediaDirectory: "/media/src", scheme: "template", template: "{title} [{videoId}]", source, video });
    expect(result.basename).toBe("My Video [abc123XYZ_-]");
  });

  it("turns a literal '/' in the template into a real subfolder", () => {
    const result = resolveVideoPaths({ mediaDirectory: "/media/src", scheme: "template", template: "{channel}/{title}", source, video });
    expect(result.directory).toBe("/media/src/My Channel");
    expect(result.basename).toBe("My Video [abc123XYZ_-]");
  });

  it("builds the Emby/Plex/Tunarr-Shows tvshow layout", () => {
    const result = resolveVideoPaths({ mediaDirectory: "/media/src", scheme: "tvshow", template: "{title}", source, video, season: 2026, episode: 7 });
    expect(result.directory).toBe("/media/src/Season 2026");
    expect(result.basename).toBe("My Channel - S2026E007 - My Video [abc123XYZ_-]");
    expect(result.posterSuffix).toBe("-thumb");
    expect(result.sidecarExtension).toBe(".info.json");
    expect(result.showNfoPath).toBe("/media/src/tvshow.nfo");
  });

  it("falls back to the current year for tvshow season when uploadDate is unknown", () => {
    const result = resolveVideoPaths({
      mediaDirectory: "/media/src",
      scheme: "tvshow",
      template: "{title}",
      source,
      video: { ...video, uploadDate: null },
      episode: 1
    });
    expect(result.directory).toBe(`/media/src/Season ${new Date().getUTCFullYear()}`);
  });
});

describe("extractVideoId", () => {
  it("recovers the id from a bracketed suffix (template/tvshow schemes)", () => {
    expect(extractVideoId("My Channel - My Video [abc123XYZ_-]")).toBe("abc123XYZ_-");
  });

  it("treats the whole basename as the id when there's no bracket (id scheme, back-compat)", () => {
    expect(extractVideoId("abc123XYZ_-")).toBe("abc123XYZ_-");
    // Back-compat with existing tunarr.test.ts fixtures that use short non-11-char stand-in ids -- the
    // original pre-naming-scheme behavior never validated length either, it just used the whole basename.
    expect(extractVideoId("first")).toBe("first");
  });
});

describe("assignEpisodeNumber", () => {
  it("assigns 1 for the first video in a season and increments monotonically without renumbering earlier ones", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({
      data: { name: "Episode numbering test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `test-${suffix}`, mediaDirectory: "/tmp/unused" }
    });
    const videoA = await db.video.create({ data: { youtubeId: `video-a-${suffix}`, title: "A", youtubeUrl: `https://youtube.com/watch?v=a-${suffix}` } });
    const videoB = await db.video.create({ data: { youtubeId: `video-b-${suffix}`, title: "B", youtubeUrl: `https://youtube.com/watch?v=b-${suffix}` } });
    const videoC = await db.video.create({ data: { youtubeId: `video-c-${suffix}`, title: "C", youtubeUrl: `https://youtube.com/watch?v=c-${suffix}` } });
    const membershipA = await db.sourceVideo.create({ data: { sourceId: source.id, videoId: videoA.id } });
    const membershipB = await db.sourceVideo.create({ data: { sourceId: source.id, videoId: videoB.id } });

    try {
      const episodeA = await assignEpisodeNumber(source.id, 2026, membershipA.id);
      expect(episodeA).toBe(1);
      const episodeB = await assignEpisodeNumber(source.id, 2026, membershipB.id);
      expect(episodeB).toBe(2);

      // Re-assigning A doesn't happen in normal use (callers only call this once per membership), but
      // confirm the counter reads the max already on the season rather than membership count, so a
      // membership added out of order still gets the next free number, not a collision.
      const membershipC = await db.sourceVideo.create({ data: { sourceId: source.id, videoId: videoC.id } });
      const episodeC = await assignEpisodeNumber(source.id, 2026, membershipC.id);
      expect(episodeC).toBe(3);

      const stored = await db.sourceVideo.findUnique({ where: { id: membershipA.id } });
      expect(stored).toMatchObject({ seasonNumber: 2026, episodeNumber: 1 });
    } finally {
      await db.source.delete({ where: { id: source.id } });
      await db.video.deleteMany({ where: { id: { in: [videoA.id, videoB.id, videoC.id] } } });
    }
  }, 15_000);

  it("keeps separate seasons independently numbered", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({
      data: { name: "Multi-season test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `test-${suffix}`, mediaDirectory: "/tmp/unused" }
    });
    const video2025 = await db.video.create({ data: { youtubeId: `video-2025-${suffix}`, title: "2025", youtubeUrl: `https://youtube.com/watch?v=2025-${suffix}` } });
    const video2026 = await db.video.create({ data: { youtubeId: `video-2026-${suffix}`, title: "2026", youtubeUrl: `https://youtube.com/watch?v=2026-${suffix}` } });
    const membership2025 = await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video2025.id } });
    const membership2026 = await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video2026.id } });

    try {
      expect(await assignEpisodeNumber(source.id, 2025, membership2025.id)).toBe(1);
      expect(await assignEpisodeNumber(source.id, 2026, membership2026.id)).toBe(1);
    } finally {
      await db.source.delete({ where: { id: source.id } });
      await db.video.deleteMany({ where: { id: { in: [video2025.id, video2026.id] } } });
    }
  }, 15_000);
});
