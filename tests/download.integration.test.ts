import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { downloadVideo, retagVideo } from "@/lib/downloads/service";

const cleanup: string[] = [];

afterEach(async () => {
  delete process.env.YTARR_YTDLP_PATH;
  delete process.env.YTARR_FFMPEG_PATH;
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("download pipeline", () => {
  it("publishes an MP4 and sidecar only after the downloader succeeds", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-download-test-"));
    cleanup.push(root);
    const sourceDirectory = path.join(root, "source");
    const fakeYtDlp = path.join(root, "yt-dlp");
    const fakeFfmpeg = path.join(root, "ffmpeg");
    await writeFile(fakeYtDlp, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const template = args[args.indexOf("-o") + 1];
fs.writeFileSync(template.replace("%(ext)s", "mp4"), "fake-mp4");
`);
    await writeFile(fakeFfmpeg, "#!/bin/sh\nexit 0\n");
    await chmod(fakeYtDlp, 0o755);
    await chmod(fakeFfmpeg, 0o755);
    process.env.YTARR_YTDLP_PATH = fakeYtDlp;
    process.env.YTARR_FFMPEG_PATH = fakeFfmpeg;

    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({
      data: { name: "Download test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `test-${suffix}`, mediaDirectory: sourceDirectory }
    });
    const video = await db.video.create({
      data: { youtubeId: `video-${suffix}`, title: "Download test video", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}` }
    });
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id } });

    try {
      const result = await downloadVideo(source.id, video.id);
      expect((await stat(result.localPath)).isFile()).toBe(true);
      expect(await readFile(result.localPath, "utf8")).toBe("fake-mp4");
      const sidecar = JSON.parse(await readFile(path.join(sourceDirectory, `${video.youtubeId}.json`), "utf8"));
      expect(sidecar).toMatchObject({ youtubeId: video.youtubeId, title: "Download test video" });
      const nfo = await readFile(path.join(sourceDirectory, `${video.youtubeId}.nfo`), "utf8");
      expect(nfo).toContain("<title>Download test video</title>");
      const membership = await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId: source.id, videoId: video.id } } });
      expect(membership?.downloadStatus).toBe("complete");
      expect(membership?.localPath).toBe(result.localPath);
    } finally {
      await db.source.delete({ where: { id: source.id } });
      await db.video.delete({ where: { id: video.id } });
    }
  }, 15_000);

  it("regenerates the .nfo/.json sidecars for an already-downloaded video without touching the media file", async () => {
    // Tunarr's "other_videos" scanner reads title/plot from a Kodi-style .nfo sidecar, never from the
    // video file's own container metadata -- so repairing metadata must not re-encode or rewrite the .mp4.
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-retag-test-"));
    cleanup.push(root);
    const sourceDirectory = path.join(root, "source");
    await mkdir(sourceDirectory, { recursive: true });

    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({
      data: { name: "Retag test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `test-${suffix}`, mediaDirectory: sourceDirectory }
    });
    const video = await db.video.create({
      data: { youtubeId: `video-${suffix}`, title: "Retag <test> & video", description: "A description with a & an <ampersand>", uploader: "Some Uploader", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}` }
    });
    const localPath = path.join(sourceDirectory, `${video.youtubeId}.mp4`);
    await writeFile(localPath, "original-mp4");
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id, downloadStatus: "complete", localPath, fileSize: 12 } });

    try {
      const result = await retagVideo(source.id, video.id) as { localPath: string };
      expect(result.localPath).toBe(localPath);
      expect(await readFile(localPath, "utf8")).toBe("original-mp4");
      const nfo = await readFile(path.join(sourceDirectory, `${video.youtubeId}.nfo`), "utf8");
      expect(nfo).toContain("<title>Retag &lt;test&gt; &amp; video</title>");
      expect(nfo).toContain("<plot>A description with a &amp; an &lt;ampersand&gt;</plot>");
      expect(nfo).toContain("<studio>Some Uploader</studio>");
      const sidecar = JSON.parse(await readFile(path.join(sourceDirectory, `${video.youtubeId}.json`), "utf8"));
      expect(sidecar).toMatchObject({ youtubeId: video.youtubeId, title: "Retag <test> & video" });
    } finally {
      await db.source.delete({ where: { id: source.id } });
      await db.video.delete({ where: { id: video.id } });
    }
  }, 15_000);
});
