import { constants, createReadStream } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { AppError } from "@/lib/api";
import { RENDERS_ROOT } from "@/lib/constants";
import { db } from "@/lib/db/client";
import { ffprobeMediaInfo } from "@/lib/ffmpeg/probe";
import { renderVideoWithOverlay } from "@/lib/ffmpeg/compose";
import { extractVideoFrame } from "@/lib/ffmpeg/thumbnail";
import { writeLog } from "@/lib/logging/service";
import { parseBindings, renderOverlayLayers, resolveBindingValues } from "@/lib/overlay/service";
import { parseRange } from "@/lib/playback/service";
import { revealInFileManager } from "@/lib/system/reveal";

async function exists(file: string) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

type RenderableMediaItem = Awaited<ReturnType<typeof loadMediaItem>>;

function loadMediaItem(mediaItemId: string) {
  return db.mediaItem.findUnique({ where: { id: mediaItemId }, include: { sourceVideo: true } });
}

// A MediaItem's source file is either a directly-added local file, or the local copy of a
// SourceVideo TunarrTube already downloaded through the normal Source pipeline -- this never
// downloads anything itself, it only reads state the download job already produced.
async function resolveSourcePath(mediaItem: NonNullable<RenderableMediaItem>): Promise<string> {
  if (mediaItem.originType === "local") {
    if (!mediaItem.originLocalPath || !(await exists(mediaItem.originLocalPath))) {
      throw new AppError("MEDIA_SOURCE_MISSING", "This media item has no downloaded/local source file to render.", 422);
    }
    return mediaItem.originLocalPath;
  }
  if (!mediaItem.sourceVideo || mediaItem.sourceVideo.downloadStatus !== "complete" || !mediaItem.sourceVideo.localPath) {
    throw new AppError("SOURCE_VIDEO_NOT_DOWNLOADED", "This item's video has not finished downloading yet.", 422);
  }
  if (!(await exists(mediaItem.sourceVideo.localPath))) {
    throw new AppError("MEDIA_SOURCE_MISSING", "This item's downloaded file is missing on disk.", 422);
  }
  return mediaItem.sourceVideo.localPath;
}

export async function renderMediaItem(mediaItemId: string, templateId: string, signal?: AbortSignal) {
  const [mediaItem, template] = await Promise.all([
    loadMediaItem(mediaItemId),
    db.overlayTemplate.findUnique({ where: { id: templateId } })
  ]);
  if (!mediaItem) throw new AppError("MEDIA_ITEM_NOT_FOUND", "Media item not found.", 404);
  if (!template) throw new AppError("TEMPLATE_NOT_FOUND", "Overlay template not found.", 404);
  const sourcePath = await resolveSourcePath(mediaItem);

  const existing = await db.renderedAsset.findUnique({ where: { mediaItemId_templateId: { mediaItemId, templateId } } });
  if (existing?.status === "complete" && existing.outputPath && (await exists(existing.outputPath))) {
    return existing; // Dedup: this exact (clip, template) pair was already rendered.
  }

  const asset = await db.renderedAsset.upsert({
    where: { mediaItemId_templateId: { mediaItemId, templateId } },
    create: { mediaItemId, templateId, status: "rendering" },
    update: { status: "rendering", error: null }
  });

  try {
    const info = await ffprobeMediaInfo(sourcePath, signal);
    const values = resolveBindingValues(mediaItem, parseBindings(template));
    const layerPngs = await renderOverlayLayers(mediaItemId, template, values);

    await mkdir(RENDERS_ROOT, { recursive: true });
    const outputPath = path.join(RENDERS_ROOT, `${mediaItemId}__${templateId}.mp4`);
    await renderVideoWithOverlay(
      sourcePath,
      layerPngs.map(({ layer, pngPath }) => ({ pngPath, timing: layer.timing })),
      outputPath,
      { videoWidth: info.width ?? 1920, videoHeight: info.height ?? 1080, audioCodec: info.audioCodec, durationSeconds: info.durationSeconds },
      signal
    );

    const details = await stat(outputPath);

    // Best-effort preview frame -- a failed extraction must not fail the render itself, since the
    // render's own output is already good on disk at this point.
    const thumbnailPath = path.join(RENDERS_ROOT, `${mediaItemId}__${templateId}.jpg`);
    let thumbnailOk = false;
    try {
      await extractVideoFrame(outputPath, thumbnailPath, Math.min(1, info.durationSeconds / 2), signal);
      thumbnailOk = true;
    } catch (thumbError) {
      await writeLog({ category: "render", mediaItemId, message: `Rendered "${mediaItem.title}" but could not generate a preview thumbnail: ${thumbError instanceof Error ? thumbError.message : String(thumbError)}` });
    }

    const complete = await db.renderedAsset.update({
      where: { id: asset.id },
      data: {
        status: "complete",
        outputPath,
        outputDurationSeconds: Math.round(info.durationSeconds),
        outputFileSize: BigInt(details.size),
        thumbnailPath: thumbnailOk ? thumbnailPath : null,
        overlayPngPaths: JSON.stringify(layerPngs.map((entry) => entry.pngPath)),
        renderedAt: new Date(),
        error: null
      }
    });
    await writeLog({ category: "render", mediaItemId, message: `Rendered "${mediaItem.title}" with template "${template.name}".` });
    return complete;
  } catch (error) {
    await db.renderedAsset.update({
      where: { id: asset.id },
      data: { status: "failed", error: (error instanceof Error ? error.message : String(error)).slice(-2000) }
    });
    throw error;
  }
}

// Streams a completed render's output file, with Range support -- mirrors the local-file branch
// of lib/playback/service.ts's playbackResponse, minus the cache/stream-fallback machinery that
// doesn't apply here (a rendered asset always lives at a single local path once complete).
export async function renderStreamResponse(assetId: string, request: Request, head = false) {
  const asset = await db.renderedAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw new AppError("RENDER_NOT_FOUND", "Rendered asset not found.", 404);
  if (asset.status !== "complete" || !asset.outputPath) throw new AppError("RENDER_NOT_READY", "This render is not complete yet.", 409);
  const details = await stat(asset.outputPath).catch(() => { throw new AppError("RENDER_FILE_MISSING", "The rendered file is missing on disk.", 404); });
  const range = parseRange(request.headers.get("range"), details.size);
  const headers = new Headers({ "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "Content-Type": "video/mp4" });
  if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${details.size}`);
  headers.set("Content-Length", String(range ? range.end - range.start + 1 : details.size));
  if (head) return new Response(null, { status: range ? 206 : 200, headers });
  const stream = createReadStream(asset.outputPath, range ? { start: range.start, end: range.end } : undefined);
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers });
}

// Opens the host OS's file manager with the rendered file selected, so the operator can find it
// on disk without hunting through storage/media/_renders by hand.
export async function revealRenderedAsset(assetId: string) {
  const asset = await db.renderedAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw new AppError("RENDER_NOT_FOUND", "Rendered asset not found.", 404);
  if (!asset.outputPath) throw new AppError("RENDER_NOT_READY", "This render has no output file yet.", 409);
  if (!(await exists(asset.outputPath))) throw new AppError("RENDER_FILE_MISSING", "The rendered file is missing on disk.", 404);
  await revealInFileManager(asset.outputPath);
}
