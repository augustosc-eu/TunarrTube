import { beforeEach, describe, expect, it, vi } from "vitest";

const runProcess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/system/process", () => ({ runProcess }));
vi.mock("@/lib/system/binaries", () => ({ discoverBinary: async () => "/usr/bin/yt-dlp" }));
vi.mock("@/lib/settings/service", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/settings/service")>(),
  siteRequestSettings: async () => ({ cookiesPath: "/config/cookies.txt", sleepRequestsSeconds: 1 })
}));

const { analyzeSource } = await import("@/lib/youtube/ytdlp");

const listUrl = "https://space.bilibili.com/3669403/lists/3958082?type=season";
const video = (bvid: string) => ({ _type: "url", ie_key: "BiliBili", id: bvid, url: `https://www.bilibili.com/video/${bvid}` });

function respond(byUrl: Record<string, unknown>) {
  runProcess.mockImplementation(async (_program: string, args: string[]) => {
    const body = byUrl[args[args.length - 1]];
    if (!body) throw new Error(`unexpected yt-dlp URL ${args[args.length - 1]}`);
    return { stdout: JSON.stringify(body), stderr: "" };
  });
}

describe("analyzing a Bilibili profile with a hidden-mode collection", () => {
  beforeEach(() => {
    runProcess.mockReset();
  });

  it("fetches the collection with the same pinned extractors, cookies, limit, and signal", async () => {
    respond({
      "https://space.bilibili.com/3669403/video": {
        id: "3669403", title: "Uploads",
        entries: [video("BV1GJ411x7h7"), { _type: "url", ie_key: "BilibiliCollectionList", id: "3669403_3958082", url: listUrl }]
      },
      [listUrl]: { id: "3669403_3958082", playlist_count: 2, entries: [video("BV1GJ411x7h7"), video("BV1aaaaaaaaa")] }
    });
    const controller = new AbortController();
    const analysis = await analyzeSource("https://space.bilibili.com/3669403", { historyLimit: 50 }, controller.signal);

    expect(analysis.entries.map((entry) => entry.youtubeId)).toEqual(["bilibili.BV1GJ411x7h7", "bilibili.BV1aaaaaaaaa"]);
    expect(runProcess).toHaveBeenCalledTimes(2);
    const [, collectionArgs, collectionOptions] = runProcess.mock.calls[1];
    expect(collectionArgs).toEqual([
      "--dump-single-json", "--flat-playlist", "--no-warnings", "--playlist-end", "50",
      "--use-extractors", "bilibili.*", "--cookies", "/config/cookies.txt", "--sleep-requests", "1", "--", listUrl
    ]);
    expect(collectionOptions.signal).toBe(controller.signal);
    expect(collectionOptions.timeoutMs).toBeGreaterThan(0);
    expect(collectionOptions.timeoutMs).toBeLessThanOrEqual(10 * 60_000);
  });

  it("surfaces a failed collection fetch rather than syncing the profile without it", async () => {
    respond({
      "https://space.bilibili.com/3669403/video": {
        id: "3669403", entries: [{ _type: "url", ie_key: "BilibiliCollectionList", id: "3669403_3958082", url: listUrl }]
      },
      [listUrl]: "not a playlist"
    });
    await expect(analyzeSource("https://space.bilibili.com/3669403", { historyLimit: null })).rejects.toMatchObject({ code: "INVALID_YTDLP_JSON" });
  });
});
