import { describe, expect, it, vi } from "vitest";
import { extractVideoId, resolveVideoPaths } from "@/lib/naming/service";
import { effectivePlaybackMode } from "@/lib/playback/service";
import { assertPlaybackModeSupported } from "@/lib/sources/service";
import { expandNestedPlaylists, MAX_NESTED_PLAYLISTS, normalizeChannel, normalizeEntry, normalizePlaylist } from "@/lib/youtube/normalize";
import { isAllowedStreamUrl, previewSourceUrl, SITES, siteForStoredId, siteForStoredUrl, siteForUrl, storageId } from "@/lib/youtube/sites";
import { validateSourceUrl, validateVideoUrl } from "@/lib/youtube/url";
import { isSignInRequiredError, isUnavailableVideoError, readableUnavailabilityReason, resolveStreamUrl, siteArgs, unavailabilityReason } from "@/lib/youtube/ytdlp";

describe("supported-site allow-list", () => {
  it.each([
    "https://example.com/video/BV1GJ411x7h7",
    "https://www.bilibili.tv.evil.example/en/video/123",
    "https://live.bilibili.com/123",
    "https://b23.tv/abc",
    "http://www.bilibili.com/video/BV1GJ411x7h7"
  ])("rejects %s", (input) => expect(() => validateSourceUrl(input)).toThrow(/supported/));

  it("leaves unknown hosts unmatched rather than defaulting to a site", () => {
    expect(siteForUrl("https://example.com/")).toBeNull();
    expect(siteForUrl("not a url")).toBeNull();
  });

  it("pins every site's yt-dlp run to its own extractors so the generic extractor can't run", () => {
    expect(siteArgs(SITES.bilibili)).toEqual(["--use-extractors", "bilibili.*"]);
    expect(siteArgs(SITES.youtube).slice(0, 2)).toEqual(["--use-extractors", "youtube.*"]);
    expect(siteArgs(SITES.youtube)).toContain("--js-runtimes");
  });
});

describe("Bilibili URL input", () => {
  it.each([
    ["https://www.bilibili.com/video/BV1GJ411x7h7?spm_id_from=333.1007&vd_source=abc", "https://www.bilibili.com/video/BV1GJ411x7h7"],
    ["https://m.bilibili.com/video/BV1GJ411x7h7/", "https://www.bilibili.com/video/BV1GJ411x7h7"],
    ["https://bilibili.com/video/bv1GJ411x7h7", "https://www.bilibili.com/video/BV1GJ411x7h7"],
    ["https://www.bilibili.com/video/BV1bK411W797?p=3&t=12", "https://www.bilibili.com/video/BV1bK411W797?p=3"],
    ["https://www.bilibili.com/video/av170001", "https://www.bilibili.com/video/av170001"]
  ])("canonicalizes video %s", (input, expected) => {
    expect(validateSourceUrl(input)).toEqual({ url: expected, sourceType: "video", site: "bilibili" });
    expect(validateVideoUrl(input)).toBe(expected);
  });

  it.each([
    "https://space.bilibili.com/3985676",
    "https://space.bilibili.com/3985676/",
    "https://space.bilibili.com/3985676/video",
    "https://space.bilibili.com/3985676/upload/video?tid=0"
  ])("treats profile %s as a channel", (input) => {
    expect(validateSourceUrl(input)).toEqual({ url: "https://space.bilibili.com/3985676/video", sourceType: "channel", site: "bilibili" });
  });

  it.each([
    ["https://space.bilibili.com/2142762/lists/3662502?type=season", "https://space.bilibili.com/2142762/lists/3662502?type=season"],
    ["https://space.bilibili.com/1958703906/lists/547718?type=series&spm=x", "https://space.bilibili.com/1958703906/lists/547718?type=series"],
    ["https://space.bilibili.com/2142762/channel/collectiondetail?sid=3662502", "https://space.bilibili.com/2142762/lists/3662502?type=season"],
    ["https://space.bilibili.com/84912/favlist?fid=1103407912&ftype=create", "https://space.bilibili.com/84912/favlist?fid=1103407912"],
    ["https://www.bilibili.com/medialist/detail/ml1103407912", "https://www.bilibili.com/medialist/detail/ml1103407912"]
  ])("treats list %s as a playlist", (input, expected) => {
    expect(validateSourceUrl(input)).toEqual({ url: expected, sourceType: "playlist", site: "bilibili" });
  });

  it.each([
    "https://www.bilibili.com/",
    "https://www.bilibili.com/video/BV123",
    "https://space.bilibili.com/3985676/audio",
    "https://space.bilibili.com/3985676/favlist"
  ])("rejects unsupported Bilibili page %s", (input) => expect(() => validateSourceUrl(input)).toThrow(/Bilibili video, playlist, or channel/));
});

describe("Bilibili normalization", () => {
  it("namespaces IDs and rebuilds the watch URL from the ID", () => {
    const entry = normalizeEntry({ id: "BV1GJ411x7h7", title: "Hello", webpage_url: "https://evil.example/video", thumbnail: "http://i0.hdslb.com/bfs/archive/a.jpg" }, 1, SITES.bilibili);
    expect(entry).toMatchObject({
      youtubeId: "bilibili.BV1GJ411x7h7",
      youtubeUrl: "https://www.bilibili.com/video/BV1GJ411x7h7",
      thumbnailUrl: "https://i0.hdslb.com/bfs/archive/a.jpg"
    });
  });

  it("recovers multi-part IDs from flat entries that carry only a URL", () => {
    const playlist = normalizePlaylist({
      _type: "playlist", id: "BV1bK411W797", title: "Parts",
      entries: [{ url: "https://www.bilibili.com/video/BV1bK411W797?p=1" }, { url: "https://www.bilibili.com/video/BV1bK411W797?p=2" }]
    }, "https://www.bilibili.com/video/BV1bK411W797");
    expect(playlist.youtubeId).toBe("bilibili.BV1bK411W797");
    expect(playlist.entries.map((entry) => [entry.youtubeId, entry.youtubeUrl])).toEqual([
      ["bilibili.BV1bK411W797_p1", "https://www.bilibili.com/video/BV1bK411W797?p=1"],
      ["bilibili.BV1bK411W797_p2", "https://www.bilibili.com/video/BV1bK411W797?p=2"]
    ]);
  });

  it("drops entries whose ID isn't a shape the site produces", () => {
    expect(normalizeEntry({ id: "../../etc" }, 1, SITES.bilibili)).toBeNull();
    expect(normalizeEntry({ id: "229832" }, 1, SITES.bilibili)).toBeNull();
  });

  it("namespaces Bilibili profile IDs", () => {
    const channel = normalizeChannel({ id: "3985676", title: "Uploads", entries: [{ id: "BV1GJ411x7h7" }] }, "https://space.bilibili.com/3985676/video", "videos", 100);
    expect(channel.youtubeId).toBe("bilibili.3985676");
    expect(channel.sourceType).toBe("channel");
  });

  it("leaves YouTube IDs bare", () => {
    expect(normalizeEntry({ id: "rtX9Fof1muY" })?.youtubeId).toBe("rtX9Fof1muY");
    expect(storageId(SITES.youtube, "rtX9Fof1muY")).toBe("rtX9Fof1muY");
    expect(siteForStoredId("rtX9Fof1muY").id).toBe("youtube");
    expect(siteForStoredId("bilibili.BV1GJ411x7h7").id).toBe("bilibili");
  });
});

describe("Bilibili hidden-mode collections on a profile", () => {
  const profile = "https://space.bilibili.com/3669403/video";
  const listUrl = (sid: string) => `https://space.bilibili.com/3669403/lists/${sid}?type=season`;
  // The stub yt-dlp's BilibiliSpaceVideoIE emits for a collection hidden from the uploads list.
  const collection = (sid: string) => ({ _type: "url", ie_key: "BilibiliCollectionList", id: `3669403_${sid}`, url: listUrl(sid) });
  const video = (bvid: string) => ({ _type: "url", ie_key: "BiliBili", id: bvid, url: `https://www.bilibili.com/video/${bvid}` });
  const ids = (raw: Record<string, unknown>) => normalizeChannel(raw, profile, "videos", null).entries.map((entry) => [entry.youtubeId, entry.playlistIndex]);

  it("recognizes the real collection stub shape and only canonical list URLs", () => {
    expect(SITES.bilibili.nestedPlaylist!(collection("3958082"))).toEqual({ url: listUrl("3958082") });
    expect(SITES.bilibili.nestedPlaylist!(video("BV1GJ411x7h7"))).toBeNull();
    expect(SITES.bilibili.nestedPlaylist!({ ...collection("1"), url: "https://evil.example/3669403/lists/1" })).toEqual({ url: null });
    expect(SITES.bilibili.nestedPlaylist!({ ...collection("1"), url: "http://space.bilibili.com/3669403/lists/1?type=season" })).toEqual({ url: null });
    expect(SITES.bilibili.nestedPlaylist!({ ...collection("1"), id: "999_1" })).toEqual({ url: null });
    expect(SITES.youtube.nestedPlaylist).toBeUndefined();
  });

  it("expands a collection into its videos in channel order", async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe(listUrl("3958082"));
      return { id: "3669403_3958082", playlist_count: 2, entries: [{ ...video("BV1aaaaaaaaa"), playlist_index: 1 }, { ...video("BV1bbbbbbbbb"), playlist_index: 2 }] };
    });
    const raw = await expandNestedPlaylists({ id: "3669403", entries: [video("BV1GJ411x7h7"), collection("3958082"), video("BV1ccccccccc")] }, SITES.bilibili, null, fetch);
    expect(fetch).toHaveBeenCalledOnce();
    expect(ids(raw)).toEqual([["bilibili.BV1GJ411x7h7", 1], ["bilibili.BV1aaaaaaaaa", 2], ["bilibili.BV1bbbbbbbbb", 3], ["bilibili.BV1ccccccccc", 4]]);
  });

  it("keeps a video listed both directly and in a collection once", async () => {
    const fetch = async () => ({ entries: [video("BV1GJ411x7h7"), video("BV1aaaaaaaaa"), video("BV1aaaaaaaaa")] });
    const raw = await expandNestedPlaylists({ id: "3669403", entries: [video("BV1GJ411x7h7"), collection("1"), collection("2")] }, SITES.bilibili, null, fetch);
    expect(ids(raw).map(([id]) => id)).toEqual(["bilibili.BV1GJ411x7h7", "bilibili.BV1aaaaaaaaa"]);
  });

  it("honors the history limit and skips collections past it", async () => {
    const fetch = vi.fn(async () => ({ entries: [video("BV1aaaaaaaaa"), video("BV1bbbbbbbbb"), video("BV1ccccccccc")] }));
    const raw = await expandNestedPlaylists({ id: "3669403", entries: [video("BV1GJ411x7h7"), collection("1"), collection("2")] }, SITES.bilibili, 3, fetch);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(listUrl("1"), 3);
    expect(ids(raw).map(([id]) => id)).toEqual(["bilibili.BV1GJ411x7h7", "bilibili.BV1aaaaaaaaa", "bilibili.BV1bbbbbbbbb"]);
  });

  it.each([
    ["an unrecognized collection link", [{ ...collection("1"), url: "https://space.bilibili.com/3669403/lists/abc" }], async () => ({ entries: [] })],
    ["an entry that isn't a video", [{ id: "229832" }], async () => ({ entries: [] })],
    ["a collection without a video list", [collection("1")], async () => ({ id: "x" })],
    ["a collection returning fewer videos than it reports", [collection("1")], async () => ({ playlist_count: 3, entries: [video("BV1aaaaaaaaa")] })],
    ["a collection nested in a collection", [collection("1")], async () => ({ entries: [collection("2")] })],
    ["a malformed entry inside a collection", [collection("1")], async () => ({ entries: [{ id: "../../etc" }] })]
  ])("refuses %s instead of syncing an incomplete profile", async (_label, entries, fetch) => {
    await expect(expandNestedPlaylists({ id: "3669403", entries }, SITES.bilibili, null, fetch)).rejects.toMatchObject({ code: "YTDLP_PLAYLIST_INCOMPLETE" });
  });

  it("caps how many collections one profile may expand", async () => {
    const entries = Array.from({ length: MAX_NESTED_PLAYLISTS + 1 }, (_, index) => collection(String(index + 1)));
    const fetch = vi.fn(async (url: string) => ({ entries: [video(`BV1${url.match(/lists\/(\d+)/)![1].padStart(9, "0")}`)] }));
    await expect(expandNestedPlaylists({ id: "3669403", entries }, SITES.bilibili, null, fetch)).rejects.toMatchObject({ code: "NESTED_PLAYLIST_LIMIT" });
    expect(fetch).toHaveBeenCalledTimes(MAX_NESTED_PLAYLISTS);
  });

  it("refuses an unexpanded collection in normalization instead of dropping it", () => {
    expect(() => normalizeChannel({ id: "3669403", entries: [video("BV1GJ411x7h7"), collection("1")] }, profile, "videos", null)).toThrow(/wasn't expanded/);
  });

  it("leaves other sites' listings untouched", async () => {
    const raw = { id: "UC1", entries: [{ id: "rtX9Fof1muY" }] };
    expect(await expandNestedPlaylists(raw, SITES.youtube, null, async () => { throw new Error("unexpected fetch"); })).toBe(raw);
  });
});

describe("bilibili.tv (international site)", () => {
  it.each([
    ["https://www.bilibili.tv/en/video/4799522620971520", "https://www.bilibili.tv/en/video/4799522620971520", "video"],
    ["https://bilibili.tv/th/video/4799522620971520?bstar_from=bstar-web", "https://www.bilibili.tv/en/video/4799522620971520", "video"],
    ["https://m.bilibili.tv/video/4799522620971520/", "https://www.bilibili.tv/en/video/4799522620971520", "video"],
    ["https://www.bilibili.tv/en/play/34613/341736", "https://www.bilibili.tv/en/play/34613/341736", "video"],
    ["https://www.biliintl.com/EN/play/34613/341736", "https://www.bilibili.tv/en/play/34613/341736", "video"],
    ["https://www.bilibili.tv/en/play/34613", "https://www.bilibili.tv/en/play/34613", "playlist"],
    ["https://www.bilibili.tv/en/media/1048837", "https://www.bilibili.tv/en/media/1048837", "playlist"]
  ])("canonicalizes %s", (input, url, sourceType) => {
    expect(validateSourceUrl(input)).toEqual({ url, sourceType, site: "bilibilitv" });
  });

  it.each([
    "https://www.bilibili.tv/en/",
    "https://www.bilibili.tv/en/space/123",
    "https://www.bilibili.tv/en/video/abc",
    "https://www.bilibili.tv/en/media/1048837/5",
    "https://www.bilibili.tv/zh_hk/video/4799522620971520",
    "http://www.bilibili.tv/en/video/4799522620971520"
  ])("rejects %s", (input) => expect(() => validateSourceUrl(input)).toThrow());

  it("doesn't suggest a channel link, which bilibili.tv doesn't have", () => {
    expect(() => validateSourceUrl("https://www.bilibili.tv/en/space/123")).toThrow("Enter a bilibili.tv video or playlist URL.");
  });

  it("keeps bilibili.tv and bilibili.com separate", () => {
    expect(siteForUrl("https://www.bilibili.tv/en/video/1")?.id).toBe("bilibilitv");
    expect(siteForUrl("https://www.bilibili.com/video/BV1GJ411x7h7")?.id).toBe("bilibili");
    expect(siteForStoredId("bilibilitv.4799522620971520").id).toBe("bilibilitv");
    expect(siteArgs(SITES.bilibilitv)).toEqual(["--use-extractors", "biliintl.*"]);
  });

  it("maps a full extraction of an uploaded video", () => {
    // Shape from yt-dlp 2026.08.19 on https://www.bilibili.tv/en/video/4799522620971520.
    const entry = normalizeEntry({
      id: "4799522620971520", title: "UTADA HIKARU LIVE", upload_date: "20260513", extractor_key: "BiliIntl",
      webpage_url: "https://www.bilibili.tv/en/video/4799522620971520", thumbnail: "https://pic.bstarstatic.com/ugc/e8de8dbd2bb96d87137ae4d2188fd501.jpg"
    }, 1, SITES.bilibilitv);
    expect(entry).toMatchObject({
      youtubeId: "bilibilitv.4799522620971520",
      youtubeUrl: "https://www.bilibili.tv/en/video/4799522620971520",
      title: "UTADA HIKARU LIVE",
      thumbnailUrl: "https://pic.bstarstatic.com/ugc/e8de8dbd2bb96d87137ae4d2188fd501.jpg"
    });
  });

  it("keys episodes by season and episode, from a series' flat stubs", () => {
    // biliIntl:series yields url_result(smuggle_url(".../en/play/<season>/<ep>", metadata), BiliIntl, "<ep>").
    const playlist = normalizePlaylist({
      _type: "playlist", id: "34613", title: "Series",
      entries: [
        { _type: "url", ie_key: "BiliIntl", id: "341735", url: "https://www.bilibili.tv/en/play/34613/341735#__youtubedl_smuggle=%7B%22title%22%3A%22E1%22%7D" },
        { _type: "url", ie_key: "BiliIntl", id: "341736", url: "https://www.bilibili.tv/en/play/34613/341736" }
      ]
    }, "https://www.bilibili.tv/en/play/34613");
    expect(playlist.youtubeId).toBe("bilibilitv.34613");
    expect(playlist.entries.map((entry) => [entry.youtubeId, entry.youtubeUrl])).toEqual([
      ["bilibilitv.s34613e341735", "https://www.bilibili.tv/en/play/34613/341735"],
      ["bilibilitv.s34613e341736", "https://www.bilibili.tv/en/play/34613/341736"]
    ]);
  });

  it("drops entries whose ID or host doesn't match their URL", () => {
    expect(normalizeEntry({ id: "999", webpage_url: "https://www.bilibili.tv/en/video/4799522620971520" }, 1, SITES.bilibilitv)).toBeNull();
    expect(normalizeEntry({ id: "1736", url: "https://www.bilibili.tv/en/play/34613/341736" }, 1, SITES.bilibilitv)).toBeNull();
    expect(normalizeEntry({ id: "4799522620971520", webpage_url: "https://evil.example/en/video/4799522620971520" }, 1, SITES.bilibilitv)).toBeNull();
    expect(normalizeEntry({ id: "4799522620971520" }, 1, SITES.bilibilitv)).toBeNull();
  });

  it("round-trips IDs through filenames", () => {
    const video = { youtubeId: "bilibilitv.s34613e341736", title: "E2 - The First Night", uploadDate: null };
    const resolved = resolveVideoPaths({ mediaDirectory: "/m", scheme: "template", template: "{title}", source: { name: "Show" }, video });
    expect(resolved.basename).toBe("E2 - The First Night [bilibilitv.s34613e341736]");
    expect(extractVideoId(resolved.basename)).toBe(video.youtubeId);
    expect(extractVideoId("Clip [bilibili.BV1GJ411x7h7]")).toBe("bilibili.BV1GJ411x7h7");
  });

  it("can't stream and has no channel feed", () => {
    expect(SITES.bilibilitv.supportsStreaming).toBe(false);
    expect(effectivePlaybackMode("stream", "https://www.bilibili.tv/en/video/4799522620971520")).toBe("cache");
    expect(SITES.bilibilitv.channelFeeds).toEqual([]);
    expect(isAllowedStreamUrl(SITES.bilibilitv, "https://upos-bstar1-mirrorakam.akamaized.net/x.m4s")).toBe(false);
  });
});

describe("Bilibili IDs in filenames", () => {
  const source = { name: "Show" };
  const video = { youtubeId: "bilibili.BV1bK411W797_p2", title: "Part two", uploadDate: new Date("2024-02-03T00:00:00Z") };

  it("round-trips through every naming scheme so Tunarr programs map back", () => {
    const id = resolveVideoPaths({ mediaDirectory: "/m", scheme: "id", template: "{title}", source, video });
    const template = resolveVideoPaths({ mediaDirectory: "/m", scheme: "template", template: "{title}", source, video });
    expect(id.basename).toBe("bilibili.BV1bK411W797_p2");
    expect(template.basename).toBe("Part two [bilibili.BV1bK411W797_p2]");
    expect(extractVideoId(id.basename)).toBe(video.youtubeId);
    expect(extractVideoId(template.basename)).toBe(video.youtubeId);
  });

  it("doesn't mistake a bracketed title fragment for a site ID", () => {
    const resolved = resolveVideoPaths({ mediaDirectory: "/m", scheme: "template", template: "{title}", source, video: { ...video, title: "Song [feat.Someone]" } });
    expect(extractVideoId(resolved.basename)).toBe(video.youtubeId);
  });
});

describe("site capabilities", () => {
  it("refuses stream mode for a Bilibili source but not a YouTube one", () => {
    expect(() => assertPlaybackModeSupported("https://space.bilibili.com/1/video", "stream")).toThrow(/Bilibili sources can't use Stream/);
    expect(() => assertPlaybackModeSupported("https://space.bilibili.com/1/video", "cache")).not.toThrow();
    expect(() => assertPlaybackModeSupported("https://www.youtube.com/@x", "stream")).not.toThrow();
    expect(() => assertPlaybackModeSupported("channel:abc", "stream")).not.toThrow();
  });

  it("caches Bilibili videos that land in a stream-mode collection", () => {
    expect(effectivePlaybackMode("stream", "https://www.bilibili.com/video/BV1GJ411x7h7")).toBe("cache");
    expect(effectivePlaybackMode("stream", "https://www.youtube.com/watch?v=rtX9Fof1muY")).toBe("stream");
    expect(effectivePlaybackMode("download", "https://www.bilibili.com/video/BV1GJ411x7h7")).toBe("download");
  });

  it("never asks yt-dlp for a Bilibili stream URL", async () => {
    await expect(resolveStreamUrl("https://www.bilibili.com/video/BV1GJ411x7h7")).rejects.toThrow(/can't be streamed/);
  });

  it("only offers Bilibili profiles their single uploads feed", () => {
    expect(SITES.bilibili.channelFeeds).toEqual(["videos"]);
    expect(SITES.bilibili.channelFeedUrl("https://space.bilibili.com/1/video", "videos")).toBe("https://space.bilibili.com/1/video");
    expect(SITES.youtube.channelFeedUrl("https://www.youtube.com/@x", "live")).toBe("https://www.youtube.com/@x/streams");
  });

  it("reads Bilibili's yt-dlp error lines and names the right site for sign-in", async () => {
    expect(readableUnavailabilityReason("ERROR: [BiliBili] BV1GJ411x7h7: This video may be deleted or geo-restricted.")).toBe("This video may be deleted or geo-restricted.");
    await expect(unavailabilityReason("https://www.bilibili.com/video/BV1GJ411x7h7", "Sign in to confirm your age")).resolves.toMatch(/^Requires Bilibili sign-in/);
    expect(siteForStoredUrl("https://www.bilibili.com/video/BV1GJ411x7h7").id).toBe("bilibili");
  });
});

describe("additional sites: URL input", () => {
  it.each([
    // Internet Archive items (single video, or one file inside a multi-file item)
    ["https://archive.org/details/Popeye_forPresident", "https://archive.org/details/Popeye_forPresident", "video", "archive"],
    ["https://www.archive.org/details/ToMyDaughterWithLove1994Pt.1/To-My-Daughter-With-Love-_1994_-pt.-2.mp4", "https://archive.org/details/ToMyDaughterWithLove1994Pt.1/To-My-Daughter-With-Love-_1994_-pt.-2.mp4", "video", "archive"],
    ["https://archive.org/details/some_item/My%20Movie.mp4", "https://archive.org/details/some_item/My%20Movie.mp4", "video", "archive"],
    // Vimeo
    ["https://vimeo.com/1235788780", "https://vimeo.com/1235788780", "video", "vimeo"],
    ["https://www.vimeo.com/channels/staffpicks/1235788780", "https://vimeo.com/1235788780", "video", "vimeo"],
    ["https://player.vimeo.com/video/1235788780", "https://vimeo.com/1235788780", "video", "vimeo"],
    ["https://vimeo.com/staff", "https://vimeo.com/staff", "channel", "vimeo"],
    ["https://vimeo.com/staff/videos", "https://vimeo.com/staff", "channel", "vimeo"],
    ["https://vimeo.com/channels/staffpicks", "https://vimeo.com/channels/staffpicks", "playlist", "vimeo"],
    ["https://vimeo.com/album/123456", "https://vimeo.com/showcase/123456", "playlist", "vimeo"],
    // Dailymotion
    ["https://www.dailymotion.com/video/xbnvc92", "https://www.dailymotion.com/video/xbnvc92", "video", "dailymotion"],
    ["https://www.dailymotion.com/video/xbnvc92_some-title", "https://www.dailymotion.com/video/xbnvc92", "video", "dailymotion"],
    ["https://dai.ly/xbnvc92", "https://www.dailymotion.com/video/xbnvc92", "video", "dailymotion"],
    ["https://www.dailymotion.com/playlist/x6hynp", "https://www.dailymotion.com/playlist/x6hynp", "playlist", "dailymotion"],
    ["https://www.dailymotion.com/dailymotion", "https://www.dailymotion.com/dailymotion", "channel", "dailymotion"],
    // Twitch
    ["https://www.twitch.tv/videos/2908640776?t=5m", "https://www.twitch.tv/videos/2908640776", "video", "twitch"],
    ["https://clips.twitch.tv/LivelyFrigidApeLeeroyJenkins-D01Eij0_9y-oFwAu", "https://clips.twitch.tv/LivelyFrigidApeLeeroyJenkins-D01Eij0_9y-oFwAu", "video", "twitch"],
    ["https://www.twitch.tv/twitch/clip/LivelyFrigidApeLeeroyJenkins-D01Eij0_9y-oFwAu", "https://clips.twitch.tv/LivelyFrigidApeLeeroyJenkins-D01Eij0_9y-oFwAu", "video", "twitch"],
    ["https://www.twitch.tv/Twitch", "https://www.twitch.tv/twitch", "channel", "twitch"],
    ["https://www.twitch.tv/twitch/videos?filter=archives", "https://www.twitch.tv/twitch", "channel", "twitch"],
    ["https://m.twitch.tv/twitch/clips", "https://www.twitch.tv/twitch/clips?filter=clips&range=all", "playlist", "twitch"],
    // Niconico
    ["https://www.nicovideo.jp/watch/sm9", "https://www.nicovideo.jp/watch/sm9", "video", "niconico"],
    ["https://nico.ms/sm9", "https://www.nicovideo.jp/watch/sm9", "video", "niconico"],
    ["https://sp.nicovideo.jp/watch/so123", "https://www.nicovideo.jp/watch/so123", "video", "niconico"],
    ["https://www.nicovideo.jp/user/4", "https://www.nicovideo.jp/user/4/video", "channel", "niconico"],
    ["https://www.nicovideo.jp/user/4/mylist/123", "https://www.nicovideo.jp/mylist/123", "playlist", "niconico"],
    ["https://www.nicovideo.jp/series/456", "https://www.nicovideo.jp/series/456", "playlist", "niconico"]
  ])("parses %s", (input, url, sourceType, site) => {
    expect(validateSourceUrl(input)).toEqual({ url, sourceType, site });
  });

  it.each([
    "https://archive.org/search?query=popeye",
    "https://archive.org/details/../etc",
    "https://archive.org/details/item/a%2F..%2Fsecret",
    "https://vimeo.com/ondemand/somefilm",
    "https://vimeo.com/watchlater",
    "https://www.dailymotion.com/search/cats/videos",
    "https://www.twitch.tv/directory",
    "https://www.twitch.tv/videos",
    "https://live.nicovideo.jp/watch/lv123",
    "https://www.nicovideo.jp/tag/music"
  ])("rejects unsupported page %s", (input) => expect(() => validateSourceUrl(input)).toThrow());

  it("pins the new sites to their own extractors", () => {
    expect(siteArgs(SITES.archive)).toEqual(["--use-extractors", "archive\\.org"]);
    expect(siteArgs(SITES.twitch)).toEqual(["--use-extractors", "twitch.*"]);
    expect(siteArgs(SITES.niconico)).toEqual(["--use-extractors", "niconico.*"]);
  });
});

describe("additional sites: yt-dlp entries", () => {
  it("keys Internet Archive files inside a multi-file item by a filename-safe hash", () => {
    const playlist = normalizePlaylist({
      _type: "playlist", id: "ToMyDaughterWithLove1994Pt.1", title: "To My Daughter",
      entries: [
        { id: "ToMyDaughterWithLove1994Pt.1/To-My-Daughter-With-Love-_1994_-pt.-1.mp4", title: "pt. 1" },
        { id: "ToMyDaughterWithLove1994Pt.1/To-My-Daughter-With-Love-_1994_-pt.-2.mp4", title: "pt. 2" }
      ]
    }, "https://archive.org/details/ToMyDaughterWithLove1994Pt.1");
    expect(playlist.youtubeId).toBe("archive.ToMyDaughterWithLove1994Pt.1");
    const [first, second] = playlist.entries;
    expect(first.youtubeId).toMatch(/^archive\.ToMyDaughterWithLove1994Pt\.1\.f[0-9a-f]{8}$/);
    expect(second.youtubeId).not.toBe(first.youtubeId);
    expect(second.youtubeUrl).toBe("https://archive.org/details/ToMyDaughterWithLove1994Pt.1/To-My-Daughter-With-Love-_1994_-pt.-2.mp4");
    // A later per-file fetch (metadata job, collection add) reports the same raw id, so it maps to the same row.
    expect(normalizeEntry({ id: "ToMyDaughterWithLove1994Pt.1/To-My-Daughter-With-Love-_1994_-pt.-2.mp4" }, 1, SITES.archive)?.youtubeId).toBe(second.youtubeId);
    expect(normalizeEntry({ id: "Popeye_forPresident" }, 1, SITES.archive)).toMatchObject({ youtubeId: "archive.Popeye_forPresident", youtubeUrl: "https://archive.org/details/Popeye_forPresident" });
  });

  it("keys Twitch VODs by id and clips by slug, whether flat or fully extracted", () => {
    expect(normalizeEntry({ id: "v2908640776", url: "https://www.twitch.tv/videos/2908640776" }, 1, SITES.twitch)).toMatchObject({ youtubeId: "twitch.v2908640776", youtubeUrl: "https://www.twitch.tv/videos/2908640776" });
    const slug = "LivelyFrigidApeLeeroyJenkins-D01Eij0_9y-oFwAu";
    const flat = normalizeEntry({ id: "386809196", url: `https://www.twitch.tv/twitch/clip/${slug}` }, 1, SITES.twitch);
    const full = normalizeEntry({ id: "386809196", display_id: slug, webpage_url: `https://clips.twitch.tv/${slug}` }, 1, SITES.twitch);
    expect(flat?.youtubeId).toBe(`twitch.${slug}`);
    expect(full?.youtubeId).toBe(flat?.youtubeId);
    expect(full?.youtubeUrl).toBe(`https://clips.twitch.tv/${slug}`);
  });

  it("recovers Niconico IDs from URL-only flat entries", () => {
    expect(normalizeEntry({ id: null, url: "https://www.nicovideo.jp/watch/sm18219289" }, 1, SITES.niconico)).toMatchObject({ youtubeId: "niconico.sm18219289", youtubeUrl: "https://www.nicovideo.jp/watch/sm18219289" });
  });

  it("rebuilds Vimeo and Dailymotion URLs from their IDs", () => {
    expect(normalizeEntry({ id: "1235788780", url: "https://evil.example/x" }, 1, SITES.vimeo)?.youtubeUrl).toBe("https://vimeo.com/1235788780");
    expect(normalizeEntry({ id: "xbnvc92" }, 1, SITES.dailymotion)?.youtubeUrl).toBe("https://www.dailymotion.com/video/xbnvc92");
    expect(normalizeEntry({ id: "not a vimeo id" }, 1, SITES.vimeo)).toBeNull();
  });

  it("round-trips dotted Internet Archive IDs through filenames", () => {
    const video = { youtubeId: "archive.ToMyDaughterWithLove1994Pt.1.f0a1b2c3d", title: "pt. 2", uploadDate: null };
    const template = resolveVideoPaths({ mediaDirectory: "/m", scheme: "template", template: "{title}", source: { name: "S" }, video });
    expect(extractVideoId(template.basename)).toBe(video.youtubeId);
  });
});

describe("additional sites: capabilities", () => {
  it("lets Internet Archive stream from archive.org hosts only", () => {
    expect(isAllowedStreamUrl(SITES.archive, "https://archive.org/download/Cosas_-_8_8_1980/Cosas_-_8_8_1980.mp4")).toBe(true);
    expect(isAllowedStreamUrl(SITES.archive, "https://ia800300.us.archive.org/1/items/x/x.mp4")).toBe(true);
    expect(isAllowedStreamUrl(SITES.archive, "https://archive.org.evil.example/x.mp4")).toBe(false);
    expect(isAllowedStreamUrl(SITES.youtube, "https://rr1---sn-abc.googlevideo.com/videoplayback")).toBe(true);
    expect(effectivePlaybackMode("stream", "https://archive.org/details/Popeye_forPresident")).toBe("stream");
    for (const site of ["vimeo", "dailymotion", "twitch", "niconico"] as const) {
      expect(SITES[site].supportsStreaming).toBe(false);
    }
  });

  it("treats Vimeo's and other sites' login walls as sign-in-required", () => {
    expect(isSignInRequiredError("ERROR: [vimeo] 1235788780: The web client only works when logged-in. Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd, or --netrc (vimeo) to provide account credentials.")).toBe(true);
    expect(isUnavailableVideoError("ERROR: [twitch:vod] 123: Video 123 does not exist")).toBe(true);
  });

  it("keeps preview parsing in step with the server for form hints", () => {
    expect(previewSourceUrl("https://www.twitch.tv/twitch")).toEqual({ url: "https://www.twitch.tv/twitch", sourceType: "channel", site: "twitch" });
    expect(previewSourceUrl("https://example.com/")).toBeNull();
    expect(previewSourceUrl("not a url")).toBeNull();
    expect(SITES.vimeo.note).toMatch(/cookies file/);
  });
});

describe("additional sites: titles", () => {
  it("decodes HTML-escaped titles from non-YouTube flat entries", () => {
    expect(normalizeEntry({ id: "1235788780", title: "What&#039;s new &amp; &#x4E2D;" }, 1, SITES.vimeo)?.title).toBe("What's new & 中");
    expect(normalizeEntry({ id: "rtX9Fof1muY", title: "Tom &amp; Jerry" })?.title).toBe("Tom &amp; Jerry");
  });
});
