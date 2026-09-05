import { afterEach, describe, expect, it, vi } from "vitest";
import { TunarrApiClient } from "@/lib/tunarr/client";
import { mapPrograms, orderMemberships } from "@/lib/tunarr/service";
import { normalizeTunarrUrl } from "@/lib/settings/service";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const paths = {
  "/api/media-sources": { get: {}, post: {} },
  "/api/media-sources/{id}/libraries/{libraryId}/scan": { post: {} },
  "/api/media-sources/{mediaSourceId}/{libraryId}/status": { get: {} },
  "/api/media-libraries/{libraryId}/programs": { get: {} },
  "/api/channels": { get: {}, post: {} },
  "/api/channels/{id}": { put: {} },
  "/api/channels/{id}/programming": { post: {} },
  "/api/transcode_configs": { get: {} }
};

describe("Tunarr client", () => {
  it("discovers the configured server and its channel capabilities", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/openapi.json")) return Response.json({ info: { version: "1.3.13" }, paths });
      if (url.endsWith("/api/version")) return Response.json({ tunarr: "1.3.13", ffmpeg: "7.1", nodejs: "22" });
      if (url.endsWith("/api/system/health")) return Response.json({ database: { type: "healthy" } });
      return Response.json({ message: "missing" }, { status: 404 });
    }));
    const result = await new TunarrApiClient("http://tunarr.test").testConnection();
    expect(result.version.tunarr).toBe("1.3.13");
    expect(result.capabilities).toEqual({ localMedia: true, channelCreate: true, channelUpdate: true, programming: true });
  });

  it("creates local media using the documented payload", async () => {
    let received: unknown;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      received = JSON.parse(String(init.body));
      return Response.json({ id: "local-source" }, { status: 201 });
    }));
    await expect(new TunarrApiClient("http://tunarr.test").createLocalMediaSource("TunarrTube - News", "/media/news")).resolves.toBe("local-source");
    expect(received).toEqual({ name: "TunarrTube - News", type: "local", mediaType: "other_videos", paths: ["/media/news"], pathReplacements: [] });
  });

  it("waits for a queued library scan to actually start when the initial status is idle", async () => {
    vi.useFakeTimers();
    const states = ["not_scanning", "in_progress", "not_scanning"];
    const fetchMock = vi.fn(async () => Response.json({ state: states.shift() ?? "not_scanning" }));
    vi.stubGlobal("fetch", fetchMock);

    const wait = new TunarrApiClient("http://tunarr.test").waitForLibraryScan(
      "source-1",
      "library-1",
      undefined,
      async () => false
    );
    await vi.runAllTimersAsync();

    await expect(wait).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("Tunarr publishing helpers", () => {
  it("normalizes safe base URLs and rejects embedded credentials", () => {
    expect(normalizeTunarrUrl("http://127.0.0.1:8000/")).toBe("http://127.0.0.1:8000");
    expect(() => normalizeTunarrUrl("http://user:secret@localhost:8000")).toThrow(/without credentials/);
  });

  it("orders memberships and maps scanned filenames by stable YouTube ID", () => {
    const memberships = [
      { playlistIndex: 2, video: { youtubeId: "second", uploadDate: new Date("2024-01-02") } },
      { playlistIndex: 1, video: { youtubeId: "first", uploadDate: new Date("2024-01-01") } }
    ];
    expect(orderMemberships(memberships, "playlist").map((item) => item.video.youtubeId)).toEqual(["first", "second"]);
    expect(orderMemberships(memberships, "newest").map((item) => item.video.youtubeId)).toEqual(["second", "first"]);
    expect(mapPrograms([
      { type: "content", id: "program-second", duration: 2000, program: { externalId: "/media/second.mp4" } },
      { type: "content", id: "program-first", duration: 1000, program: { externalId: "/media/first.mp4" } }
    ], orderMemberships(memberships, "playlist"))).toEqual([
      { type: "content", id: "program-first", duration: 1000 },
      { type: "content", id: "program-second", duration: 2000 }
    ]);
  });
});
