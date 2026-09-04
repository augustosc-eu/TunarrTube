import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { publishSourceToTunarr } from "@/lib/tunarr/service";

afterEach(() => vi.unstubAllGlobals());

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

describe("Tunarr publish pipeline", () => {
  it("registers local media, scans it, creates a channel, and assigns programming", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const mediaDirectory = `/tmp/ytarr-tunarr-${suffix}`;
    const source = await db.source.create({
      data: { name: "Tunarr test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `tunarr-${suffix}`, mediaDirectory }
    });
    const video = await db.video.create({
      data: { youtubeId: `youtube-${suffix}`, title: "Tunarr test video", youtubeUrl: `https://youtube.com/watch?v=youtube-${suffix}`, uploadDate: new Date("2024-01-01") }
    });
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id, playlistIndex: 1, downloadStatus: "complete", localPath: `${mediaDirectory}/${video.youtubeId}.mp4` } });

    let mediaSourceCreated = false;
    let channelPayload: Record<string, unknown> | null = null;
    let programmingPayload: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (urlValue: string, init?: RequestInit) => {
      const url = new URL(urlValue);
      const method = init?.method ?? "GET";
      if (url.pathname === "/openapi.json") return Response.json({ info: { version: "1.3.13" }, paths });
      if (url.pathname === "/api/media-sources" && method === "GET") return Response.json(mediaSourceCreated ? [{ id: "source-1", name: "YTarr - Tunarr test", type: "local", paths: [mediaDirectory], libraries: [{ id: "library-1", name: mediaDirectory, mediaType: "other_videos", externalKey: mediaDirectory, enabled: true }] }] : []);
      if (url.pathname === "/api/media-sources" && method === "POST") { mediaSourceCreated = true; return Response.json({ id: "source-1" }, { status: 201 }); }
      if (url.pathname.endsWith("/scan") && method === "POST") return Response.json({}, { status: 202 });
      if (url.pathname.endsWith("/status")) return Response.json({ state: "not_scanning" });
      if (url.pathname === "/api/media-libraries/library-1/programs") return Response.json([{ type: "content", id: "program-1", duration: 60_000, program: { externalId: `${mediaDirectory}/${video.youtubeId}.mp4` } }]);
      if (url.pathname === "/api/channels" && method === "GET") return Response.json([]);
      if (url.pathname === "/api/transcode_configs") return Response.json([{ id: "07925780-d3ba-476e-ba5c-bf0d89c58245", isDefault: true }]);
      if (url.pathname === "/api/channels" && method === "POST") {
        const body = JSON.parse(String(init?.body)); channelPayload = body.channel;
        return Response.json(body.channel, { status: 201 });
      }
      if (url.pathname.endsWith("/programming") && method === "POST") {
        programmingPayload = JSON.parse(String(init?.body));
        return Response.json({});
      }
      return Response.json({ message: `Unexpected ${method} ${url.pathname}` }, { status: 404 });
    }));

    try {
      const result = await publishSourceToTunarr(source.id, { channelName: "YTarr Test TV", channelNumber: 42, programmingOrder: "playlist" });
      expect(result).toMatchObject({ channelNumber: 42, programCount: 1, mediaSourceId: "source-1", libraryId: "library-1" });
      expect(channelPayload).toMatchObject({ name: "YTarr Test TV", number: 42, duration: 60_000, groupTitle: "YTarr" });
      expect(programmingPayload).toEqual({ type: "manual", lineup: [{ type: "content", id: "program-1", duration: 60_000 }], append: false });
      const linked = await db.source.findUnique({ where: { id: source.id } });
      expect(linked).toMatchObject({ tunarrMediaSourceId: "source-1", tunarrLibraryId: "library-1", tunarrChannelNumber: 42 });
      expect(linked?.tunarrChannelId).toBeTruthy();
      expect(linked?.tunarrLastPublishedAt).toBeInstanceOf(Date);
    } finally {
      await db.source.delete({ where: { id: source.id } });
      await db.video.delete({ where: { id: video.id } });
    }
  });

  it("keeps an existing channel's number on refresh instead of bumping it to the next available slot", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const mediaDirectory = `/tmp/ytarr-tunarr-renumber-${suffix}`;
    const existingChannelId = `channel-${suffix}`;
    const source = await db.source.create({
      data: { name: "Renumber test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `tunarr-renumber-${suffix}`, mediaDirectory, tunarrChannelId: existingChannelId, tunarrChannelNumber: 5 }
    });
    const video = await db.video.create({
      data: { youtubeId: `youtube-renumber-${suffix}`, title: "Renumber test video", youtubeUrl: `https://youtube.com/watch?v=youtube-renumber-${suffix}`, uploadDate: new Date("2024-01-01") }
    });
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id, playlistIndex: 1, downloadStatus: "complete", localPath: `${mediaDirectory}/${video.youtubeId}.mp4` } });

    let updatePayload: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (urlValue: string, init?: RequestInit) => {
      const url = new URL(urlValue);
      const method = init?.method ?? "GET";
      if (url.pathname === "/openapi.json") return Response.json({ info: { version: "1.3.13" }, paths });
      if (url.pathname === "/api/media-sources" && method === "GET") return Response.json([{ id: "source-1", name: "YTarr - Renumber test", type: "local", paths: [mediaDirectory], libraries: [{ id: "library-1", name: mediaDirectory, mediaType: "other_videos", externalKey: mediaDirectory, enabled: true }] }]);
      if (url.pathname.endsWith("/scan") && method === "POST") return Response.json({}, { status: 202 });
      if (url.pathname.endsWith("/status")) return Response.json({ state: "not_scanning" });
      if (url.pathname === "/api/media-libraries/library-1/programs") return Response.json([{ type: "content", id: "program-1", duration: 60_000, program: { externalId: `${mediaDirectory}/${video.youtubeId}.mp4` } }]);
      // Another channel already occupies a higher number, so a naive "next available" computation would bump us past it.
      if (url.pathname === "/api/channels" && method === "GET") return Response.json([{ id: existingChannelId, name: "Renumber Test TV", number: 5 }, { id: "other-channel", name: "Other", number: 9 }]);
      if (url.pathname === "/api/transcode_configs") return Response.json([{ id: "07925780-d3ba-476e-ba5c-bf0d89c58245", isDefault: true }]);
      if (url.pathname === `/api/channels/${existingChannelId}` && method === "PUT") {
        updatePayload = JSON.parse(String(init?.body));
        return Response.json({});
      }
      if (url.pathname.endsWith("/programming") && method === "POST") return Response.json({});
      return Response.json({ message: `Unexpected ${method} ${url.pathname}` }, { status: 404 });
    }));

    try {
      const result = await publishSourceToTunarr(source.id, { channelName: "Renumber Test TV", programmingOrder: "playlist" });
      expect(result.channelNumber).toBe(5);
      expect(updatePayload).toMatchObject({ number: 5 });
    } finally {
      await db.source.delete({ where: { id: source.id } });
      await db.video.delete({ where: { id: video.id } });
    }
  });
});
