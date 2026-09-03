import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { createSourceFromDraft } from "@/lib/sources/service";

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
