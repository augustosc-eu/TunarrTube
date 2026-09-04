import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { touchCacheAsset } from "@/lib/downloads/service";
import { getSettings } from "@/lib/settings/service";
import { enqueueUniqueJob } from "@/lib/sources/service";
import { resolveEffectiveQuality } from "@/lib/youtube/quality";
import { resolveStreamUrl } from "@/lib/youtube/ytdlp";

export function parseRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) throw new AppError("INVALID_RANGE", "Invalid byte range.", 416);
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new AppError("INVALID_RANGE", "Invalid byte range.", 416);
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new AppError("INVALID_RANGE", "Requested range is outside the file.", 416);
  return { start, end: Math.min(end, size - 1) };
}

export async function preparePlayback(sourceId: string, videoId: string) {
  const membership = await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId, videoId } }, include: { source: true, video: { include: { cacheAsset: true } } } });
  if (!membership || membership.membershipStatus !== "present") throw new AppError("VIDEO_NOT_IN_SOURCE", "The video is not available in this source.", 404);
  const playbackUrl = `/api/playback/${encodeURIComponent(sourceId)}/${encodeURIComponent(videoId)}`;
  if (membership.localPath && membership.downloadStatus === "complete") return { state: "ready", playbackUrl };
  if (membership.source.playbackMode === "stream") return { state: "ready", playbackUrl };
  if (membership.source.playbackMode === "cache" && membership.video.cacheAsset?.status === "complete" && membership.video.cacheAsset.localPath) return { state: "ready", playbackUrl };
  const type = membership.source.playbackMode === "cache" ? "cache" : "download";
  const job = await enqueueUniqueJob(type, sourceId, videoId, { target: type === "cache" ? "cache" : "permanent" });
  if (type === "download") await db.sourceVideo.update({ where: { id: membership.id }, data: { downloadStatus: "queued" } });
  const { kickWorker } = await import("@/lib/jobs/runner");
  kickWorker();
  return { state: "queued", playbackUrl, jobId: job.id };
}

export async function playbackResponse(sourceId: string, videoId: string, request: Request, head = false) {
  const membership = await db.sourceVideo.findUnique({ where: { sourceId_videoId: { sourceId, videoId } }, include: { source: true, video: { include: { cacheAsset: true } } } });
  if (!membership) throw new AppError("VIDEO_NOT_IN_SOURCE", "The video is not part of this source.", 404);
  const cache = membership.video.cacheAsset;
  const localPath = membership.downloadStatus === "complete" && membership.localPath ? membership.localPath : cache?.status === "complete" ? cache.localPath : null;
  if (!localPath) {
    if (membership.source.playbackMode !== "stream") throw new AppError("PLAYBACK_NOT_READY", "The video is still being prepared.", 409);
    const settings = await getSettings();
    const quality = resolveEffectiveQuality(membership.source.videoQuality, settings.defaultVideoQuality);
    const upstream = await fetch(await resolveStreamUrl(membership.video.youtubeUrl, quality, request.signal), {
      method: head ? "HEAD" : "GET",
      signal: request.signal,
      headers: request.headers.get("range") ? { Range: request.headers.get("range")! } : {},
      redirect: "follow",
      cache: "no-store"
    });
    if (!upstream.ok && upstream.status !== 206) throw new AppError("STREAM_UPSTREAM_FAILED", `YouTube stream returned ${upstream.status}.`, 502);
    const headers = new Headers({ "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "Content-Type": upstream.headers.get("content-type") ?? "video/mp4" });
    for (const name of ["content-length", "content-range"]) { const value = upstream.headers.get(name); if (value) headers.set(name, value); }
    return new Response(head ? null : upstream.body, { status: upstream.status, headers });
  }
  const details = await stat(localPath).catch(() => { throw new AppError("PLAYBACK_FILE_MISSING", "The local media file is missing.", 404); });
  const range = parseRange(request.headers.get("range"), details.size);
  const headers = new Headers({ "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "Content-Type": "video/mp4" });
  if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${details.size}`);
  headers.set("Content-Length", String(range ? range.end - range.start + 1 : details.size));
  if (cache?.localPath === localPath) {
    await db.cacheAsset.update({ where: { id: cache.id }, data: { activeReaders: { increment: 1 } } });
    await touchCacheAsset(cache.id);
  }
  if (head) {
    if (cache?.localPath === localPath) await db.cacheAsset.update({ where: { id: cache.id }, data: { activeReaders: { decrement: 1 } } });
    return new Response(null, { status: range ? 206 : 200, headers });
  }
  const stream = createReadStream(localPath, range ? { start: range.start, end: range.end } : undefined);
  if (cache?.localPath === localPath) {
    let finished = false;
    const release = () => { if (finished) return; finished = true; void db.cacheAsset.updateMany({ where: { id: cache.id, activeReaders: { gt: 0 } }, data: { activeReaders: { decrement: 1 } } }); };
    stream.once("close", release); stream.once("error", release); stream.once("end", release);
  }
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers });
}
