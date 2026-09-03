import { describe, expect, it } from "vitest";
import { normalizePlaylist, parseUploadDate } from "@/lib/youtube/normalize";
import { validatePlaylistUrl, validateSourceUrl, validateVideoUrl } from "@/lib/youtube/url";

describe("YouTube input validation", () => {
  it("accepts HTTPS playlist URLs", () => {
    expect(validatePlaylistUrl("https://www.youtube.com/playlist?list=PL123")).toContain("list=PL123");
  });

  it.each([
    "http://www.youtube.com/playlist?list=PL123",
    "https://example.com/playlist?list=PL123",
    "https://youtu.be/abc",
    "https://www.youtube.com/watch?v=abc"
  ])("rejects unsupported input %s", (input) => expect(() => validatePlaylistUrl(input)).toThrow());
});

describe("YouTube channel input", () => {
  it.each([
    "https://www.youtube.com/@example",
    "https://youtube.com/channel/UC123",
    "https://youtube.com/user/example",
    "https://youtube.com/c/example"
  ])("accepts channel URL %s", (input) => expect(validateSourceUrl(input).sourceType).toBe("channel"));

  it("keeps playlist URLs distinct from channel feeds", () => expect(validateSourceUrl("https://youtube.com/@example?list=PL123").sourceType).toBe("playlist"));
});

describe("individual YouTube video input", () => {
  it.each([
    ["https://youtu.be/rtX9Fof1muY?si=tracking", "https://www.youtube.com/watch?v=rtX9Fof1muY"],
    ["https://www.youtube.com/watch?v=rtX9Fof1muY&si=tracking", "https://www.youtube.com/watch?v=rtX9Fof1muY"],
    ["https://youtube.com/shorts/rtX9Fof1muY", "https://www.youtube.com/watch?v=rtX9Fof1muY"],
    ["https://youtube.com/live/rtX9Fof1muY", "https://www.youtube.com/watch?v=rtX9Fof1muY"]
  ])("canonicalizes %s", (input, expected) => {
    expect(validateSourceUrl(input)).toEqual({ url: expected, sourceType: "video" });
    expect(validateVideoUrl(input)).toBe(expected);
  });

  it("does not treat a video URL with a playlist as an individual video", () => {
    expect(validateSourceUrl("https://youtube.com/watch?v=rtX9Fof1muY&list=PL123").sourceType).toBe("playlist");
  });

  it.each([
    "https://youtu.be/too-short",
    "https://example.com/watch?v=rtX9Fof1muY",
    "http://youtu.be/rtX9Fof1muY"
  ])("rejects invalid video input %s", (input) => expect(() => validateVideoUrl(input)).toThrow());
});

describe("yt-dlp normalization", () => {
  it("normalizes and orders flat entries without trusting the URL for identity", () => {
    const result = normalizePlaylist({ id: "PL_REAL", title: "My List", uploader: "Channel", entries: [{ id: "abc", title: "One", duration: 62 }, { id: "def", title: "Two", availability: "private" }] }, "https://www.youtube.com/playlist?list=PL_INPUT");
    expect(result.youtubeId).toBe("PL_REAL");
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ youtubeId: "abc", playlistIndex: 1, durationSeconds: 62 });
    expect(result.entries[1].availability).toBe("unavailable");
  });

  it("rejects partial playlist output", () => expect(() => normalizePlaylist({ id: "PL" }, "https://youtube.com/playlist?list=PL")).toThrow(/complete playlist/));
  it("rejects outdated extraction that reports videos but returns no entries", () => {
    expect(() => normalizePlaylist({ id: "PL", playlist_count: 21, entries: [], _version: { version: "2024.11.18" } }, "https://youtube.com/playlist?list=PL"))
      .toThrow(/detected 21 playlist items/);
  });
  it("parses yt-dlp upload dates in UTC", () => expect(parseUploadDate("20250131")?.toISOString()).toBe("2025-01-31T00:00:00.000Z"));
});
