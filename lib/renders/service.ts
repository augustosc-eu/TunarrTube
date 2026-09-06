import { constants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/api";
import { RENDERS_ROOT } from "@/lib/constants";
import { db } from "@/lib/db/client";
import { ffprobeMediaInfo } from "@/lib/ffmpeg/probe";
import { renderVideoWithOverlay } from "@/lib/ffmpeg/compose";
import { writeLog } from "@/lib/logging/service";
import { parseBindings, renderOverlayLayers, resolveBindingValues } from "@/lib/overlay/service";

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
      { videoWidth: info.width ?? 1920, videoHeight: info.height ?? 1080, audioCodec: info.audioCodec },
      signal
    );

    const details = await stat(outputPath);
    const complete = await db.renderedAsset.update({
      where: { id: asset.id },
      data: {
        status: "complete",
        outputPath,
        outputDurationSeconds: Math.round(info.durationSeconds),
        outputFileSize: BigInt(details.size),
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
