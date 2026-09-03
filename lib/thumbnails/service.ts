import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";

const ALLOWED_HOSTS = ["ytimg.com", "ggpht.com", "googleusercontent.com", "youtube.com"];

function thumbnailRoot() { return path.resolve(process.env.YTARR_THUMBNAIL_DIR ?? path.join(process.cwd(), "storage", "thumbnails")); }
function safeRemoteUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new AppError("THUMBNAIL_URL_REJECTED", "Thumbnail host is not allowed.", 422);
  return url;
}

async function persist(kind: "source" | "video", id: string, remoteUrl: string) {
  const response = await fetch(safeRemoteUrl(remoteUrl), { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!response.ok) throw new AppError("THUMBNAIL_DOWNLOAD_FAILED", `Thumbnail returned ${response.status}.`, 502);
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const directory = path.join(thumbnailRoot(), `${kind}s`);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `${id}.${extension}`);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
  await rename(temporary, target);
  return target;
}

export async function persistSourceThumbnails(sourceId: string) {
  const source = await db.source.findUnique({ where: { id: sourceId }, include: { videos: { include: { video: true } } } });
  if (!source) throw new AppError("SOURCE_NOT_FOUND", "Source not found.", 404);
  if (source.thumbnailUrl) {
    const local = await persist("source", source.id, source.thumbnailUrl);
    if (source.thumbnailPath && source.thumbnailPath !== local) await rm(source.thumbnailPath, { force: true });
    await db.source.update({ where: { id: source.id }, data: { thumbnailPath: local } });
  }
  for (const membership of source.videos) {
    const video = membership.video;
    if (!video.thumbnailUrl || video.thumbnailPath) continue;
    try { await db.video.update({ where: { id: video.id }, data: { thumbnailPath: await persist("video", video.id, video.thumbnailUrl) } }); }
    catch { /* An individual thumbnail must not fail source synchronization. */ }
  }
}

export async function thumbnailResponse(kind: "source" | "video", id: string, request: Request) {
  const record = kind === "source"
    ? await db.source.findUnique({ where: { id }, select: { thumbnailPath: true } })
    : await db.video.findUnique({ where: { id }, select: { thumbnailPath: true } });
  if (!record?.thumbnailPath) throw new AppError("THUMBNAIL_NOT_FOUND", "Thumbnail not found.", 404);
  const details = await stat(record.thumbnailPath).catch(() => { throw new AppError("THUMBNAIL_NOT_FOUND", "Thumbnail file is missing.", 404); });
  const etag = `W/\"${details.size}-${details.mtimeMs}\"`;
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304 });
  const ext = path.extname(record.thumbnailPath).toLowerCase();
  const contentType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return new Response(Readable.toWeb(createReadStream(record.thumbnailPath)) as ReadableStream, { headers: { "Content-Type": contentType, "Content-Length": String(details.size), ETag: etag, "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } });
}

export async function removeSourceThumbnail(sourceId: string) {
  const source = await db.source.findUnique({ where: { id: sourceId }, select: { thumbnailPath: true } });
  if (source?.thumbnailPath) await rm(source.thumbnailPath, { force: true });
}
