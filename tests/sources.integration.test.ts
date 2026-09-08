import { constants } from "node:fs";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { createSourceFromDraft, removeVideoFromSource } from "@/lib/sources/service";

async function exists(file: string) {
  try { await access(file, constants.F_OK); return true; }
  catch { return false; }
}

describe("createSourceFromDraft", () => {
  it("does not crash when the analyzed playlist lists the same video twice", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const youtubeId = `video-${suffix}`;
    const entry = {
      youtubeId,
      title: "Duplicated video",
      description: null,
      durationSeconds: null,
      uploadDate: null,
      thumbnailUrl: null,
      uploader: null,
      youtubeUrl: `https://youtube.com/watch?v=${youtubeId}`,
      playlistIndex: 1,
      availability: "available" as const
    };
    const draft = await db.importDraft.create({
      data: {
        url: `https://youtube.com/playlist?list=${suffix}`,
        youtubeId: `playlist-${suffix}`,
        name: "Duplicate entry playlist",
        sourceType: "playlist",
        feedType: "playlist",
        // Same video appears twice, as real YouTube playlists occasionally do.
        entriesJson: JSON.stringify([entry, { ...entry, playlistIndex: 2 }]),
        videoCount: 2,
        expiresAt: new Date(Date.now() + 60 * 60_000)
      }
    });

    let source: Awaited<ReturnType<typeof createSourceFromDraft>> | null = null;
    try {
      source = await createSourceFromDraft(draft.id, "Duplicate entry test", "stream", false);
      const memberships = await db.sourceVideo.findMany({ where: { sourceId: source.id } });
      expect(memberships).toHaveLength(1);
      expect(memberships[0]?.playlistIndex).toBe(2);
    } finally {
      if (source) {
        await db.job.deleteMany({ where: { sourceId: source.id } });
        await db.sourceVideo.deleteMany({ where: { sourceId: source.id } });
        await rm(source.mediaDirectory, { recursive: true, force: true });
        await db.source.delete({ where: { id: source.id } });
      }
      await db.video.deleteMany({ where: { youtubeId } });
    }
  }, 15_000);
});

describe("removeVideoFromSource", () => {
  it("deletes the membership, the files it owns, and the orphaned video once no other source references it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-remove-video-test-"));
    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({
      data: { name: "Remove video test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `test-${suffix}`, mediaDirectory: root }
    });
    const video = await db.video.create({
      data: { youtubeId: `video-${suffix}`, title: "Gone video", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}`, availability: "unavailable", availabilityReason: "Video unavailable" }
    });
    const localPath = path.join(root, `${video.youtubeId}.mp4`);
    await mkdir(root, { recursive: true });
    await writeFile(localPath, "fake-mp4");
    await writeFile(`${localPath.replace(/\.mp4$/, "")}.json`, "{}");
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id, downloadStatus: "unavailable", localPath } });

    try {
      const result = await removeVideoFromSource(source.id, video.id);
      expect(result).toEqual({ removed: true });
      expect(await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId: source.id, videoId: video.id } } })).toBeNull();
      expect(await db.video.findUnique({ where: { id: video.id } })).toBeNull();
      expect(await exists(localPath)).toBe(false);
      expect(await exists(`${localPath.replace(/\.mp4$/, "")}.json`)).toBe(false);
    } finally {
      await db.sourceVideo.deleteMany({ where: { sourceId: source.id } });
      await db.video.deleteMany({ where: { id: video.id } });
      await db.source.delete({ where: { id: source.id } });
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the video row when another source still references it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-remove-video-shared-test-"));
    const suffix = `${Date.now()}-${Math.random()}`;
    const sourceA = await db.source.create({
      data: { name: "Shared video source A", url: `https://youtube.com/playlist?list=a-${suffix}`, youtubeId: `a-${suffix}`, directoryName: `test-a-${suffix}`, mediaDirectory: root }
    });
    const sourceB = await db.source.create({
      data: { name: "Shared video source B", url: `https://youtube.com/playlist?list=b-${suffix}`, youtubeId: `b-${suffix}`, directoryName: `test-b-${suffix}`, mediaDirectory: root }
    });
    const video = await db.video.create({
      data: { youtubeId: `video-${suffix}`, title: "Shared video", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}` }
    });
    await db.sourceVideo.create({ data: { sourceId: sourceA.id, videoId: video.id } });
    await db.sourceVideo.create({ data: { sourceId: sourceB.id, videoId: video.id } });

    try {
      await removeVideoFromSource(sourceA.id, video.id);
      expect(await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId: sourceA.id, videoId: video.id } } })).toBeNull();
      expect(await db.video.findUnique({ where: { id: video.id } })).not.toBeNull();
      expect(await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId: sourceB.id, videoId: video.id } } })).not.toBeNull();
    } finally {
      await db.sourceVideo.deleteMany({ where: { videoId: video.id } });
      await db.video.deleteMany({ where: { id: video.id } });
      await db.source.deleteMany({ where: { id: { in: [sourceA.id, sourceB.id] } } });
      await rm(root, { recursive: true, force: true });
    }
  });
});
