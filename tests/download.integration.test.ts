import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { downloadVideo, retagVideo } from "@/lib/downloads/service";
import { getSettings } from "@/lib/settings/service";

const cleanup: string[] = [];

afterEach(async () => {
  delete process.env.YTARR_YTDLP_PATH;
  delete process.env.YTARR_FFMPEG_PATH;
  vi.unstubAllGlobals();
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

// AppSettings is a singleton row (id: 1) shared with the running dev app, so any test that touches
// ytdlpCookiesPath must restore the value it found beforehand rather than assuming it started null.
// getSettings() guarantees the row exists (creating it from env defaults on first call) before we read it.
async function withCookiesPath(cookiesPath: string | null, run: () => Promise<void>) {
  const before = (await getSettings()).ytdlpCookiesPath;
  await db.appSettings.update({ where: { id: 1 }, data: { ytdlpCookiesPath: cookiesPath } });
  try {
    await run();
  } finally {
    await db.appSettings.update({ where: { id: 1 }, data: { ytdlpCookiesPath: before } });
  }
}

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

  it("mirrors the video's local thumbnail into a <youtubeId>-poster.<ext> sidecar so Tunarr's scanner has artwork", async () => {
    // Tunarr's "other_videos" scanner also scans for local artwork next to the .nfo (Kodi's
    // "<basename>-poster.<ext>" convention) to power its guide/now-playing image. Without it, Tunarr shows
    // a broken thumbnail for the program.
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-poster-test-"));
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

    const thumbnailPath = path.join(root, "mirrored-thumb.webp");
    await writeFile(thumbnailPath, "fake-thumbnail-bytes");

    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({
      data: { name: "Poster test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `test-${suffix}`, mediaDirectory: sourceDirectory }
    });
    const video = await db.video.create({
      data: { youtubeId: `video-${suffix}`, title: "Poster test video", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}`, thumbnailPath }
    });
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id } });

    try {
      await downloadVideo(source.id, video.id);
      const poster = await readFile(path.join(sourceDirectory, `${video.youtubeId}-poster.webp`), "utf8");
      expect(poster).toBe("fake-thumbnail-bytes");
    } finally {
      await db.source.delete({ where: { id: source.id } });
      await db.video.delete({ where: { id: video.id } });
    }
  }, 15_000);

  it("skips the poster sidecar without failing the download when no local thumbnail is mirrored yet", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-poster-missing-test-"));
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
      data: { name: "Poster missing test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `test-${suffix}`, mediaDirectory: sourceDirectory }
    });
    const video = await db.video.create({
      data: { youtubeId: `video-${suffix}`, title: "Poster missing test video", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}` }
    });
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id } });

    try {
      const result = await downloadVideo(source.id, video.id);
      expect((await stat(result.localPath)).isFile()).toBe(true);
      const membership = await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId: source.id, videoId: video.id } } });
      expect(membership?.downloadStatus).toBe("complete");
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
    const thumbnailPath = path.join(root, "mirrored-thumb.jpg");
    await writeFile(thumbnailPath, "fake-thumbnail-bytes");
    const video = await db.video.create({
      data: { youtubeId: `video-${suffix}`, title: "Retag <test> & video", description: "A description with a & an <ampersand>", uploader: "Some Uploader", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}`, thumbnailPath }
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
      // Backfills the poster sidecar for videos downloaded before this existed, or whose thumbnail
      // mirror job finished after the download did.
      const poster = await readFile(path.join(sourceDirectory, `${video.youtubeId}-poster.jpg`), "utf8");
      expect(poster).toBe("fake-thumbnail-bytes");
    } finally {
      await db.source.delete({ where: { id: source.id } });
      await db.video.delete({ where: { id: video.id } });
    }
  }, 15_000);

  it("records an age-restricted/sign-in-required video as unavailable with an actionable reason, without an extra network fetch", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-signin-test-"));
    cleanup.push(root);
    const sourceDirectory = path.join(root, "source");
    const fakeYtDlp = path.join(root, "yt-dlp");
    const fakeFfmpeg = path.join(root, "ffmpeg");
    // yt-dlp's real message for this case points at --cookies-from-browser/--cookies, which is what
    // isSignInRequiredError (lib/youtube/ytdlp.ts) matches on.
    await writeFile(fakeYtDlp, `#!/bin/sh\necho "ERROR: [youtube] SrFc0Be8b6o: Sign in to confirm your age. Use --cookies-from-browser BROWSER --cookies FILE for the authentication." 1>&2\nexit 1\n`);
    await writeFile(fakeFfmpeg, "#!/bin/sh\nexit 0\n");
    await chmod(fakeYtDlp, 0o755);
    await chmod(fakeFfmpeg, 0o755);
    process.env.YTARR_YTDLP_PATH = fakeYtDlp;
    process.env.YTARR_FFMPEG_PATH = fakeFfmpeg;
    // unavailabilityReason() skips fetchVideoAvailabilityReason()'s page fetch entirely for this case, so
    // a fetch stub that always throws proves no network call happened.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network disabled in test"); }));

    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({
      data: { name: "Sign-in test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `test-${suffix}`, mediaDirectory: sourceDirectory }
    });
    const video = await db.video.create({
      data: { youtubeId: `video-${suffix}`, title: "Sign-in test video", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}` }
    });
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id } });

    try {
      await expect(downloadVideo(source.id, video.id)).rejects.toThrow();
      const membership = await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId: source.id, videoId: video.id } } });
      expect(membership?.downloadStatus).toBe("failed");
      const refreshedVideo = await db.video.findUniqueOrThrow({ where: { id: video.id } });
      expect(refreshedVideo.availability).toBe("unavailable");
      expect(refreshedVideo.availabilityReason).toMatch(/sign-in/i);
      expect(refreshedVideo.availabilityReason).toMatch(/Settings/);
    } finally {
      await db.source.delete({ where: { id: source.id } });
      await db.video.delete({ where: { id: video.id } });
    }
  }, 15_000);

  it("passes the configured cookies file to yt-dlp when downloading", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-cookies-test-"));
    cleanup.push(root);
    const sourceDirectory = path.join(root, "source");
    const fakeYtDlp = path.join(root, "yt-dlp");
    const fakeFfmpeg = path.join(root, "ffmpeg");
    const cookiesFile = path.join(root, "cookies.txt");
    const argsCapture = path.join(root, "args.txt");
    await writeFile(cookiesFile, "# Netscape HTTP Cookie File\n");
    await writeFile(fakeYtDlp, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argsCapture)}, args.join("\\n"));
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
      data: { name: "Cookies test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `test-${suffix}`, mediaDirectory: sourceDirectory }
    });
    const video = await db.video.create({
      data: { youtubeId: `video-${suffix}`, title: "Cookies test video", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}` }
    });
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id } });

    try {
      await withCookiesPath(cookiesFile, async () => {
        await downloadVideo(source.id, video.id);
      });
      const passedArgs = (await readFile(argsCapture, "utf8")).split("\n");
      expect(passedArgs).toEqual(expect.arrayContaining(["--cookies", cookiesFile]));
    } finally {
      await db.source.delete({ where: { id: source.id } });
      await db.video.delete({ where: { id: video.id } });
    }
  }, 15_000);
});
