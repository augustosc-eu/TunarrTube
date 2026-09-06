import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { renderMediaItem } from "@/lib/renders/service";

const cleanupMediaItemIds: string[] = [];
const cleanupTemplateIds: string[] = [];
const cleanupSourceIds: string[] = [];
const cleanupVideoIds: string[] = [];
const cleanupDirs: string[] = [];

afterEach(async () => {
  await db.mediaItem.deleteMany({ where: { id: { in: cleanupMediaItemIds.splice(0) } } });
  await db.overlayTemplate.deleteMany({ where: { id: { in: cleanupTemplateIds.splice(0) } } });
  await db.source.deleteMany({ where: { id: { in: cleanupSourceIds.splice(0) } } });
  await db.video.deleteMany({ where: { id: { in: cleanupVideoIds.splice(0) } } });
  await Promise.all(cleanupDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeTemplate() {
  const template = await db.overlayTemplate.create({
    data: { name: "Render Test Template", htmlTemplate: "<div>{{title}}</div>", bindingsJson: "[]", layersJson: "[]" }
  });
  cleanupTemplateIds.push(template.id);
  return template;
}

describe("renderMediaItem", () => {
  it("returns the existing RenderedAsset without re-rendering when one is already complete on disk", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-render-dedup-test-"));
    cleanupDirs.push(root);
    const outputPath = path.join(root, "already-rendered.mp4");
    await writeFile(outputPath, "fake-rendered-mp4");

    const template = await makeTemplate();
    const mediaItem = await db.mediaItem.create({ data: { originType: "local", originLocalPath: path.join(root, "source.mp4"), title: "Dedup Test" } });
    cleanupMediaItemIds.push(mediaItem.id);
    await writeFile(mediaItem.originLocalPath!, "fake-source-mp4");
    await db.renderedAsset.create({ data: { mediaItemId: mediaItem.id, templateId: template.id, status: "complete", outputPath } });

    const result = await renderMediaItem(mediaItem.id, template.id);
    expect(result.status).toBe("complete");
    expect(result.outputPath).toBe(outputPath);
  });

  it("refuses to render a sourceVideo-origin item whose download has not finished", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({
      data: { name: "Render test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `render-test-${suffix}`, mediaDirectory: `/tmp/ytarr-render-test-${suffix}` }
    });
    const video = await db.video.create({
      data: { youtubeId: `video-${suffix}`, title: "Render test video", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}` }
    });
    const sourceVideo = await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id, downloadStatus: "downloading" } });
    cleanupSourceIds.push(source.id);
    cleanupVideoIds.push(video.id);

    const template = await makeTemplate();
    const mediaItem = await db.mediaItem.create({ data: { originType: "sourceVideo", sourceVideoId: sourceVideo.id, title: "Not downloaded yet" } });
    cleanupMediaItemIds.push(mediaItem.id);

    await expect(renderMediaItem(mediaItem.id, template.id)).rejects.toMatchObject({ code: "SOURCE_VIDEO_NOT_DOWNLOADED" });
  });

  it("refuses to render a local-origin item with no file on disk", async () => {
    const template = await makeTemplate();
    const mediaItem = await db.mediaItem.create({ data: { originType: "local", originLocalPath: "/nonexistent/path/does-not-exist.mp4", title: "Missing file" } });
    cleanupMediaItemIds.push(mediaItem.id);

    await expect(renderMediaItem(mediaItem.id, template.id)).rejects.toMatchObject({ code: "MEDIA_SOURCE_MISSING" });
  });
});
