import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { createSourceFromDraft, syncSource } from "@/lib/sources/service";

afterEach(() => {
  delete process.env.YTARR_YTDLP_PATH;
});

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

describe("syncSource", () => {
  it("does not re-queue a download for a video already recorded as unavailable (permanently gone, or sign-in-required)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-sync-unavailable-test-"));
    const fakeYtDlp = path.join(root, "yt-dlp");
    const suffix = `${Date.now()}-${Math.random()}`;
    const youtubeId = `video-${suffix}`;
    // A minimal --dump-single-json --flat-playlist response listing the one (still-present) video.
    await writeFile(fakeYtDlp, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify({
      id: `pl-${suffix}`,
      title: "Sync test playlist",
      entries: [{ id: youtubeId, title: "Sync test video", webpage_url: `https://youtube.com/watch?v=${youtubeId}` }]
    })}\nEOF\n`);
    await chmod(fakeYtDlp, 0o755);
    process.env.YTARR_YTDLP_PATH = fakeYtDlp;

    const video = await db.video.create({
      data: {
        youtubeId, title: "Sync test video", youtubeUrl: `https://youtube.com/watch?v=${youtubeId}`,
        // Set by the sign-in-required/unavailable handling in enrichVideo/downloadVideo/cacheVideo
        // (lib/metadata/service.ts, lib/downloads/service.ts) before this test's sync ever runs.
        availability: "unavailable", availabilityReason: "Requires YouTube sign-in.", metadataStatus: "complete"
      }
    });
    const source = await db.source.create({
      data: {
        name: "Sync unavailable test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: `pl-${suffix}`,
        sourceType: "playlist", feedType: "playlist", directoryName: `test-${suffix}`, mediaDirectory: path.join(root, "media"),
        playbackMode: "download"
      }
    });
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id, downloadStatus: "failed" } });

    try {
      await syncSource(source.id);
      const job = await db.job.findFirst({ where: { type: "download", sourceId: source.id, videoId: video.id } });
      expect(job).toBeNull();
      const membership = await db.sourceVideo.findUniqueOrThrow({ where: { sourceId_videoId: { sourceId: source.id, videoId: video.id } } });
      expect(membership.downloadStatus).toBe("failed");
    } finally {
      await db.job.deleteMany({ where: { sourceId: source.id } });
      await db.sourceVideo.deleteMany({ where: { sourceId: source.id } });
      await db.source.delete({ where: { id: source.id } });
      await db.video.delete({ where: { id: video.id } });
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
