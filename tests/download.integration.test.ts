import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { downloadVideo, retagVideo, VideoUnavailableError } from "@/lib/downloads/service";
import { getSettings } from "@/lib/settings/service";

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

const cleanup: string[] = [];

afterEach(async () => {
  delete process.env.TUNARRTUBE_YTDLP_PATH;
  delete process.env.TUNARRTUBE_FFMPEG_PATH;
  vi.unstubAllGlobals();
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("download pipeline", () => {
  it("publishes an MP4 and sidecar only after the downloader succeeds", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-download-test-"));
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
    process.env.TUNARRTUBE_YTDLP_PATH = fakeYtDlp;
    process.env.TUNARRTUBE_FFMPEG_PATH = fakeFfmpeg;

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
    const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-poster-test-"));
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
    process.env.TUNARRTUBE_YTDLP_PATH = fakeYtDlp;
    process.env.TUNARRTUBE_FFMPEG_PATH = fakeFfmpeg;

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
    const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-poster-missing-test-"));
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
    process.env.TUNARRTUBE_YTDLP_PATH = fakeYtDlp;
    process.env.TUNARRTUBE_FFMPEG_PATH = fakeFfmpeg;

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

  it("records a local file error as an ordinary, retryable failure -- not stuck downloading, not unavailable", async () => {
    // reuseExistingAsset hardlinks, then falls back to copying, another source's completed file. When both
    // fail (here: the recorded path is a directory, which can be neither hardlinked nor copied), the
    // membership must be marked failed like any other download error -- it used to stay "downloading"
    // after the job had already given up. The filesystem error's message embeds the paths, and "deleted"
    // in this media root (or "/private/" in any macOS temp path) used to be read as YouTube reporting the
    // video gone, marking it permanently unavailable for every source.
    const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-deleted-scenes-"));
    cleanup.push(root);
    const sourceDirectory = path.join(root, "source");
    const unreadableAsset = path.join(root, "other-source", "not-a-file.mp4");
    await mkdir(unreadableAsset, { recursive: true });

    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({
      data: { name: "Reuse failure test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `test-${suffix}`, mediaDirectory: sourceDirectory }
    });
    const otherSource = await db.source.create({
      data: { name: "Reuse failure other", url: `https://youtube.com/playlist?list=other-${suffix}`, youtubeId: `other-${suffix}`, directoryName: `test-other-${suffix}`, mediaDirectory: path.dirname(unreadableAsset) }
    });
    const video = await db.video.create({
      data: { youtubeId: `video-${suffix}`, title: "Reuse failure video", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}` }
    });
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id } });
    await db.sourceVideo.create({ data: { sourceId: otherSource.id, videoId: video.id, downloadStatus: "complete", localPath: unreadableAsset } });

    try {
      const failure = await downloadVideo(source.id, video.id).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(VideoUnavailableError);
      const membership = await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId: source.id, videoId: video.id } } });
      expect(membership?.downloadStatus).toBe("failed");
      expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).availability).not.toBe("unavailable");
    } finally {
      await db.source.deleteMany({ where: { id: { in: [source.id, otherSource.id] } } });
      await db.video.delete({ where: { id: video.id } });
    }
  }, 15_000);

  // The bookkeeping around a download (the unavailable-video record, the log line) can fail too. Neither
  // may leave the membership in the wrong state: it used to stay "downloading" when the unavailable
  // bookkeeping threw, and a completed download was rewritten to "failed" when the success log did.
  async function downloadWithFailingLog(ytDlpScript: string) {
    const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-log-failure-test-"));
    cleanup.push(root);
    const fakeYtDlp = path.join(root, "yt-dlp");
    const fakeFfmpeg = path.join(root, "ffmpeg");
    await writeFile(fakeYtDlp, ytDlpScript);
    await writeFile(fakeFfmpeg, "#!/bin/sh\nexit 0\n");
    await chmod(fakeYtDlp, 0o755);
    await chmod(fakeFfmpeg, 0o755);
    process.env.TUNARRTUBE_YTDLP_PATH = fakeYtDlp;
    process.env.TUNARRTUBE_FFMPEG_PATH = fakeFfmpeg;

    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({
      data: { name: "Log failure test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `test-${suffix}`, mediaDirectory: path.join(root, "source") }
    });
    const video = await db.video.create({
      data: { youtubeId: `video-${suffix}`, title: "Log failure video", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}` }
    });
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id } });
    const writeLog = vi.spyOn(await import("@/lib/logging/service"), "writeLog").mockRejectedValue(new Error("log store offline"));
    try {
      const failure = await downloadVideo(source.id, video.id).catch((error: unknown) => error);
      const membership = await db.sourceVideo.findUniqueOrThrow({ where: { sourceId_videoId: { sourceId: source.id, videoId: video.id } } });
      return { failure, downloadStatus: membership.downloadStatus };
    } finally {
      writeLog.mockRestore();
      await db.source.delete({ where: { id: source.id } });
      await db.video.delete({ where: { id: video.id } });
    }
  }

  it("records an unavailable video's status even when its bookkeeping fails afterwards", async () => {
    const result = await downloadWithFailingLog(`#!/bin/sh\necho "ERROR: [youtube] gone: Video unavailable" 1>&2\nexit 1\n`);
    expect(result.failure).toBeInstanceOf(Error);
    expect(result.downloadStatus).toBe("unavailable");
  }, 15_000);

  it("keeps a completed download complete when only the success log fails", async () => {
    const result = await downloadWithFailingLog(`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.writeFileSync(args[args.indexOf("-o") + 1].replace("%(ext)s", "mp4"), "fake-mp4");
`);
    expect(result.downloadStatus).toBe("complete");
  }, 15_000);

  it("regenerates the .nfo/.json sidecars for an already-downloaded video without touching the media file", async () => {
    // Tunarr's "other_videos" scanner reads title/plot from a Kodi-style .nfo sidecar, never from the
    // video file's own container metadata -- so repairing metadata must not re-encode or rewrite the .mp4.
    const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-retag-test-"));
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

  it("records a video yt-dlp reports as permanently gone as unavailable and throws VideoUnavailableError instead of an ordinary failure", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-unavailable-test-"));
    cleanup.push(root);
    const sourceDirectory = path.join(root, "source");
    const fakeYtDlp = path.join(root, "yt-dlp");
    const fakeFfmpeg = path.join(root, "ffmpeg");
    // yt-dlp's real exit code/stderr shape for a video that's gone for good -- see runProcess()
    // (lib/system/process.ts), which folds a nonzero exit's stderr into the rejected Error's message.
    await writeFile(fakeYtDlp, `#!/bin/sh\necho "ERROR: [youtube] video-unavailable: Video unavailable" 1>&2\nexit 1\n`);
    await writeFile(fakeFfmpeg, "#!/bin/sh\nexit 0\n");
    await chmod(fakeYtDlp, 0o755);
    await chmod(fakeFfmpeg, 0o755);
    process.env.TUNARRTUBE_YTDLP_PATH = fakeYtDlp;
    process.env.TUNARRTUBE_FFMPEG_PATH = fakeFfmpeg;
    // fetchVideoAvailabilityReason() (lib/youtube/ytdlp.ts) tries a real page fetch for a richer reason
    // before falling back to yt-dlp's own stderr line -- stub it to fail fast and deterministically.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network disabled in test"); }));

    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({
      data: { name: "Unavailable test", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `test-${suffix}`, mediaDirectory: sourceDirectory }
    });
    const video = await db.video.create({
      data: { youtubeId: `video-${suffix}`, title: "Unavailable test video", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}` }
    });
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id } });

    try {
      await expect(downloadVideo(source.id, video.id)).rejects.toBeInstanceOf(VideoUnavailableError);
      const membership = await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId: source.id, videoId: video.id } } });
      expect(membership?.downloadStatus).toBe("unavailable");
      const refreshedVideo = await db.video.findUniqueOrThrow({ where: { id: video.id } });
      expect(refreshedVideo.availability).toBe("unavailable");
      expect(refreshedVideo.availabilityReason).toBeTruthy();
    } finally {
      await db.source.delete({ where: { id: source.id } });
      await db.video.delete({ where: { id: video.id } });
    }
  }, 15_000);

  it("records an age-restricted/sign-in-required video as unavailable with an actionable reason, without an extra network fetch", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-signin-test-"));
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
    process.env.TUNARRTUBE_YTDLP_PATH = fakeYtDlp;
    process.env.TUNARRTUBE_FFMPEG_PATH = fakeFfmpeg;
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
      await expect(downloadVideo(source.id, video.id)).rejects.toBeInstanceOf(VideoUnavailableError);
      const membership = await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId: source.id, videoId: video.id } } });
      expect(membership?.downloadStatus).toBe("unavailable");
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
    const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-cookies-test-"));
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
    process.env.TUNARRTUBE_YTDLP_PATH = fakeYtDlp;
    process.env.TUNARRTUBE_FFMPEG_PATH = fakeFfmpeg;

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

  it("downloads under a Source's 'template' naming scheme override, producing a nested folder and a bracketed-id filename", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "tunarrtube-template-naming-test-")));
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
    process.env.TUNARRTUBE_YTDLP_PATH = fakeYtDlp;
    process.env.TUNARRTUBE_FFMPEG_PATH = fakeFfmpeg;

    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({
      data: {
        name: "My Channel", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `test-${suffix}`, mediaDirectory: sourceDirectory,
        namingScheme: "template", filenameTemplate: "{channel}/{title}"
      }
    });
    const video = await db.video.create({
      data: { youtubeId: `videoIdABC1${suffix.slice(0, 1)}`, title: "My Video", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}` }
    });
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id } });

    try {
      const result = await downloadVideo(source.id, video.id);
      const expectedDirectory = path.join(sourceDirectory, "My Channel");
      const expectedBasename = `My Video [${video.youtubeId}]`;
      expect(result.localPath).toBe(path.join(expectedDirectory, `${expectedBasename}.mp4`));
      expect((await stat(result.localPath)).isFile()).toBe(true);
      const sidecar = JSON.parse(await readFile(path.join(expectedDirectory, `${expectedBasename}.json`), "utf8"));
      expect(sidecar).toMatchObject({ youtubeId: video.youtubeId, title: "My Video" });
      const nfo = await readFile(path.join(expectedDirectory, `${expectedBasename}.nfo`), "utf8");
      expect(nfo).toContain("<movie>");
      expect(nfo).toContain("<title>My Video</title>");
    } finally {
      await db.source.delete({ where: { id: source.id } });
      await db.video.delete({ where: { id: video.id } });
    }
  }, 15_000);

  it("downloads under the 'tvshow' naming scheme, producing an Emby/Plex/Tunarr-Shows-compatible layout", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "tunarrtube-tvshow-naming-test-")));
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
    process.env.TUNARRTUBE_YTDLP_PATH = fakeYtDlp;
    process.env.TUNARRTUBE_FFMPEG_PATH = fakeFfmpeg;

    const thumbnailPath = path.join(root, "mirrored-thumb.jpg");
    await writeFile(thumbnailPath, "fake-thumbnail-bytes");

    const suffix = `${Date.now()}-${Math.random()}`;
    const source = await db.source.create({
      data: { name: "TV Show Channel", url: `https://youtube.com/playlist?list=${suffix}`, youtubeId: suffix, directoryName: `test-${suffix}`, mediaDirectory: sourceDirectory, namingScheme: "tvshow" }
    });
    const video = await db.video.create({
      data: {
        youtubeId: `videoIdABC2${suffix.slice(0, 1)}`, title: "Episode One", youtubeUrl: `https://youtube.com/watch?v=video-${suffix}`,
        uploadDate: new Date("2026-03-15T00:00:00Z"), description: "A description.", thumbnailPath
      }
    });
    await db.sourceVideo.create({ data: { sourceId: source.id, videoId: video.id } });

    try {
      const result = await downloadVideo(source.id, video.id);
      const seasonDirectory = path.join(sourceDirectory, "Season 2026");
      const basename = `TV Show Channel - S2026E001 - Episode One [${video.youtubeId}]`;
      expect(result.localPath).toBe(path.join(seasonDirectory, `${basename}.mp4`));

      const membership = await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId: source.id, videoId: video.id } } });
      expect(membership).toMatchObject({ seasonNumber: 2026, episodeNumber: 1 });

      const nfo = await readFile(path.join(seasonDirectory, `${basename}.nfo`), "utf8");
      expect(nfo).toContain("<episodedetails>");
      expect(nfo).toContain("<season>2026</season>");
      expect(nfo).toContain("<episode>1</episode>");
      expect(nfo).toContain(`<uniqueid type="youtube" default="true">${video.youtubeId}</uniqueid>`);

      const showNfo = await readFile(path.join(sourceDirectory, "tvshow.nfo"), "utf8");
      expect(showNfo).toContain("<tvshow>");
      expect(showNfo).toContain("<title>TV Show Channel</title>");

      const sidecar = JSON.parse(await readFile(path.join(seasonDirectory, `${basename}.info.json`), "utf8"));
      expect(sidecar).toMatchObject({ youtubeId: video.youtubeId, title: "Episode One", season: 2026, episode: 1 });

      const thumb = await readFile(path.join(seasonDirectory, `${basename}-thumb.jpg`), "utf8");
      expect(thumb).toBe("fake-thumbnail-bytes");
    } finally {
      await db.source.delete({ where: { id: source.id } });
      await db.video.delete({ where: { id: video.id } });
    }
  }, 15_000);
});
