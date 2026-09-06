import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { publishChannelToTunarr } from "@/lib/tunarr/channel-service";

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

describe("Channel Tunarr publish pipeline", () => {
  it("materializes the render, registers a music_videos local source, and publishes the channel", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-channel-publish-test-"));
    const storageDirectory = path.join(root, "channel-storage");
    const renderPath = path.join(root, "rendered.mp4");
    await writeFile(renderPath, "fake-rendered-mp4");

    const template = await db.overlayTemplate.create({
      data: { name: "Publish Test Template", htmlTemplate: "<div>{{title}}</div>", bindingsJson: "[]", layersJson: "[]" }
    });
    const channel = await db.channel.create({
      data: { name: "Publish Test Channel", slug: `publish-test-${Date.now()}`, templateId: template.id, storageDirectory }
    });
    const mediaItem = await db.mediaItem.create({ data: { originType: "local", originLocalPath: renderPath, title: "Published Song", artist: "Published Artist" } });
    await db.channelItem.create({ data: { channelId: channel.id, mediaItemId: mediaItem.id, position: 0 } });
    const renderedAsset = await db.renderedAsset.create({
      data: { mediaItemId: mediaItem.id, templateId: template.id, status: "complete", outputPath: renderPath, outputDurationSeconds: 30 }
    });

    let mediaSourceCreated = false;
    let mediaSourcePayload: Record<string, unknown> | null = null;
    let channelPayload: Record<string, unknown> | null = null;
    let programmingPayload: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (urlValue: string, init?: RequestInit) => {
      const url = new URL(urlValue);
      const method = init?.method ?? "GET";
      if (url.pathname === "/openapi.json") return Response.json({ info: { version: "1.3.13" }, paths });
      if (url.pathname === "/api/media-sources" && method === "GET") {
        return Response.json(mediaSourceCreated
          ? [{ id: "channel-source-1", name: "TunarrTube Channel - Publish Test Channel", type: "local", paths: [storageDirectory], libraries: [{ id: "library-1", name: storageDirectory, mediaType: "music_videos", externalKey: storageDirectory, enabled: true }] }]
          : []);
      }
      if (url.pathname === "/api/media-sources" && method === "POST") {
        mediaSourcePayload = JSON.parse(String(init?.body));
        mediaSourceCreated = true;
        return Response.json({ id: "channel-source-1" }, { status: 201 });
      }
      if (url.pathname.endsWith("/scan") && method === "POST") return Response.json({}, { status: 202 });
      if (url.pathname.endsWith("/status")) return Response.json({ state: "not_scanning" });
      if (url.pathname === "/api/media-libraries/library-1/programs") return Response.json([{ type: "content", id: "program-1", duration: 30_000, program: { externalId: `${storageDirectory}/${mediaItem.id}.mp4` } }]);
      if (url.pathname === "/api/channels" && method === "GET") return Response.json([]);
      if (url.pathname === "/api/transcode_configs") return Response.json([{ id: "07925780-d3ba-476e-ba5c-bf0d89c58245", isDefault: true }]);
      if (url.pathname === "/api/channels" && method === "POST") {
        const body = JSON.parse(String(init?.body));
        channelPayload = body.channel;
        return Response.json(body.channel, { status: 201 });
      }
      if (url.pathname.endsWith("/programming") && method === "POST") {
        programmingPayload = JSON.parse(String(init?.body));
        return Response.json({});
      }
      return Response.json({ message: `Unexpected ${method} ${url.pathname}` }, { status: 404 });
    }));

    try {
      const result = await publishChannelToTunarr(channel.id);
      expect(result).toMatchObject({ channelNumber: 1, programCount: 1, mediaSourceId: "channel-source-1", libraryId: "library-1" });
      expect(mediaSourcePayload).toMatchObject({ mediaType: "music_videos", paths: [storageDirectory] });
      expect(channelPayload).toMatchObject({ name: "Publish Test Channel", number: 1, duration: 30_000, groupTitle: "TunarrTube" });
      expect(programmingPayload).toEqual({ type: "manual", lineup: [{ type: "content", id: "program-1", duration: 30_000 }], append: false });

      const linked = await db.channel.findUniqueOrThrow({ where: { id: channel.id } });
      expect(linked).toMatchObject({ tunarrMediaSourceId: "channel-source-1", tunarrLibraryId: "library-1", tunarrChannelNumber: 1 });
      expect(linked.tunarrChannelId).toBeTruthy();
      expect(linked.tunarrLastPublishedAt).toBeInstanceOf(Date);
    } finally {
      await db.channel.delete({ where: { id: channel.id } });
      await db.mediaItem.delete({ where: { id: mediaItem.id } });
      await db.overlayTemplate.delete({ where: { id: template.id } });
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to publish a channel with an unrendered item", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-channel-publish-unrendered-"));
    const template = await db.overlayTemplate.create({
      data: { name: "Unrendered Template", htmlTemplate: "<div>{{title}}</div>", bindingsJson: "[]", layersJson: "[]" }
    });
    const channel = await db.channel.create({
      data: { name: "Unrendered Channel", slug: `unrendered-test-${Date.now()}`, templateId: template.id, storageDirectory: path.join(root, "storage") }
    });
    const mediaItem = await db.mediaItem.create({ data: { originType: "local", originLocalPath: path.join(root, "source.mp4"), title: "Not Rendered Yet" } });
    await db.channelItem.create({ data: { channelId: channel.id, mediaItemId: mediaItem.id, position: 0 } });

    try {
      await expect(publishChannelToTunarr(channel.id)).rejects.toMatchObject({ code: "TUNARR_UNRENDERED_ITEMS" });
    } finally {
      await db.channel.delete({ where: { id: channel.id } });
      await db.mediaItem.delete({ where: { id: mediaItem.id } });
      await db.overlayTemplate.delete({ where: { id: template.id } });
      await rm(root, { recursive: true, force: true });
    }
  });
});
