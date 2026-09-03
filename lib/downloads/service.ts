import { constants } from "node:fs";
import { access, copyFile, link, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { requireFfmpeg } from "@/lib/ffmpeg/service";
import { writeLog } from "@/lib/logging/service";
import { assertWithinDirectory, getSettings } from "@/lib/settings/service";
import { runProcess } from "@/lib/system/process";
import { getYtDlpPath } from "@/lib/youtube/ytdlp";

async function exists(file: string) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writeSidecar(target: string, data: unknown) {
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

async function downloadMp4(youtubeId: string, youtubeUrl: string, target: string) {
  const targetDirectory = path.dirname(target);
  await mkdir(targetDirectory, { recursive: true });
  const tempRoot = path.join(targetDirectory, "._ytarr-tmp");
  await mkdir(tempRoot, { recursive: true });
  const tempDirectory = path.join(tempRoot, `${youtubeId}-${Date.now()}-${process.pid}`);
  await mkdir(tempDirectory, { recursive: false });
  try {
    const ytdlp = await getYtDlpPath();
    const ffmpeg = await requireFfmpeg();
    await runProcess(ytdlp, [
      "--no-playlist", "--no-overwrites", "--newline", "--no-progress",
      "--ffmpeg-location", path.dirname(ffmpeg),
      "-f", "bv*[vcodec^=avc]+ba[acodec^=mp4a]/b[ext=mp4]/best",
      "--merge-output-format", "mp4", "--recode-video", "mp4",
      "-o", path.join(tempDirectory, `${youtubeId}.%(ext)s`), "--", youtubeUrl
    ], { timeoutMs: 12 * 60 * 60_000 });
    const files = await readdir(tempDirectory);
    const output = files.find((file) => file === `${youtubeId}.mp4`);
    if (!output) throw new AppError("DOWNLOAD_OUTPUT_MISSING", "yt-dlp completed without producing the expected MP4.", 502);
    if (!(await exists(target))) await rename(path.join(/* turbopackIgnore: true */ tempDirectory, output), target);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function reuseExistingAsset(sourceId: string, videoId: string, target: string) {
  const asset = await db.sourceVideo.findFirst({
    where: { videoId, sourceId: { not: sourceId }, downloadStatus: "complete", localPath: { not: null } }
  });
  if (!asset?.localPath || !(await exists(asset.localPath))) return false;
  try {
    await link(asset.localPath, target);
  } catch {
    const temp = `${target}.${process.pid}.copying`;
    await copyFile(asset.localPath, temp);
    await rename(temp, target);
  }
  return true;
}

export async function downloadVideo(sourceId: string, videoId: string) {
  const membership = await db.sourceVideo.findUnique({
    where: { sourceId_videoId: { sourceId, videoId } },
    include: { source: true, video: true }
  });
  if (!membership) throw new AppError("VIDEO_NOT_IN_SOURCE", "The video is not part of this source.", 404);
  const sourceDir = membership.source.mediaDirectory;
  await mkdir(sourceDir, { recursive: true });
  const target = await assertWithinDirectory(sourceDir, path.join(sourceDir, `${membership.video.youtubeId}.mp4`));
  const sidecar = await assertWithinDirectory(sourceDir, path.join(sourceDir, `${membership.video.youtubeId}.json`));
  if (membership.downloadStatus === "complete" && membership.localPath && (await exists(membership.localPath))) {
    if (membership.retentionOrigin !== "permanent") await db.sourceVideo.update({ where: { id: membership.id }, data: { retentionOrigin: "permanent" } });
    return { localPath: membership.localPath, reused: true };
  }

  await db.sourceVideo.update({ where: { id: membership.id }, data: { downloadStatus: "downloading" } });
  let reused = await reuseExistingAsset(sourceId, videoId, target);
  try {
    if (!reused) {
      await downloadMp4(membership.video.youtubeId, membership.video.youtubeUrl, target);
    }
    const details = await stat(target);
    await writeSidecar(sidecar, {
      youtubeId: membership.video.youtubeId,
      title: membership.video.title,
      description: membership.video.description,
      duration: membership.video.durationSeconds,
      uploadDate: membership.video.uploadDate?.toISOString() ?? null,
      source: membership.source.name,
      originalUrl: membership.video.youtubeUrl
    });
    await db.sourceVideo.update({ where: { id: membership.id }, data: { downloadStatus: "complete", localPath: target, fileSize: details.size, retentionOrigin: "permanent" } });
    await writeLog({ category: "download", sourceId, videoId, message: `${reused ? "Linked" : "Downloaded"} ${membership.video.youtubeId}.` });
    return { localPath: target, fileSize: details.size, reused };
  } catch (error) {
    await db.sourceVideo.update({ where: { id: membership.id }, data: { downloadStatus: "failed" } });
    throw error;
  }
}

export async function cacheVideo(videoId: string) {
  const video = await db.video.findUnique({ where: { id: videoId }, include: { cacheAsset: true } });
  if (!video) throw new AppError("VIDEO_NOT_FOUND", "Video not found.", 404);
  if (video.cacheAsset?.status === "complete" && video.cacheAsset.localPath && await exists(video.cacheAsset.localPath)) {
    await touchCacheAsset(video.cacheAsset.id);
    return video.cacheAsset;
  }
  const settings = await getSettings();
  const directory = path.join(settings.mediaBaseDirectory, "._ytarr-cache", "videos");
  const target = await assertWithinDirectory(settings.mediaBaseDirectory, path.join(directory, `${video.youtubeId}.mp4`));
  const asset = await db.cacheAsset.upsert({
    where: { videoId },
    create: { videoId, status: "downloading", localPath: target },
    update: { status: "downloading", localPath: target, error: null }
  });
  try {
    await downloadMp4(video.youtubeId, video.youtubeUrl, target);
    const details = await stat(target);
    const complete = await db.cacheAsset.update({ where: { id: asset.id }, data: { status: "complete", fileSize: details.size, cachedAt: new Date(), lastAccessedAt: new Date(), error: null } });
    await writeLog({ category: "cache", videoId, message: `Cached ${video.youtubeId}.` });
    const { enforceCachePolicy } = await import("@/lib/cache/service");
    await enforceCachePolicy();
    return complete;
  } catch (error) {
    await db.cacheAsset.update({ where: { id: asset.id }, data: { status: "failed", error: (error instanceof Error ? error.message : String(error)).slice(-2000) } });
    throw error;
  }
}

export async function touchCacheAsset(id: string) {
  const asset = await db.cacheAsset.findUnique({ where: { id }, select: { lastAccessedAt: true } });
  if (!asset || (asset.lastAccessedAt && Date.now() - asset.lastAccessedAt.getTime() < 5 * 60_000)) return;
  await db.cacheAsset.update({ where: { id }, data: { lastAccessedAt: new Date() } });
}

export async function materializeForTunarr(sourceId: string, videoId: string) {
  const membership = await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId, videoId } }, include: { source: true, video: true } });
  if (!membership) throw new AppError("VIDEO_NOT_IN_SOURCE", "The video is not part of this source.", 404);
  if (membership.retentionOrigin === "permanent" && membership.localPath && await exists(membership.localPath)) return membership.localPath;
  const asset = await cacheVideo(videoId);
  if (!asset.localPath) throw new AppError("CACHE_OUTPUT_MISSING", "The cached file is unavailable.", 500);
  await mkdir(membership.source.mediaDirectory, { recursive: true });
  const target = await assertWithinDirectory(membership.source.mediaDirectory, path.join(membership.source.mediaDirectory, `${membership.video.youtubeId}.mp4`));
  if (!(await exists(target))) {
    try { await link(asset.localPath, target); }
    catch { const temp = `${target}.${process.pid}.copying`; await copyFile(asset.localPath, temp); await rename(temp, target); }
  }
  const details = await stat(target);
  await writeSidecar(path.join(membership.source.mediaDirectory, `${membership.video.youtubeId}.json`), {
    youtubeId: membership.video.youtubeId, title: membership.video.title, description: membership.video.description,
    duration: membership.video.durationSeconds, uploadDate: membership.video.uploadDate?.toISOString() ?? null,
    source: membership.source.name, originalUrl: membership.video.youtubeUrl
  });
  await db.sourceVideo.update({ where: { id: membership.id }, data: { downloadStatus: "complete", localPath: target, fileSize: details.size, retentionOrigin: "tunarr" } });
  return target;
}
