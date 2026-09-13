import { constants } from "node:fs";
import { access, copyFile, link, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/api";
import { grabFallbackPoster, writeMusicVideoNfo, writePosterArtwork } from "@/lib/sidecar/nfo";

async function exists(file: string) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// Links (or copies) the canonical render into the channel's own storage directory as
// "<mediaItemId>.mp4" and writes the Kodi-style <musicvideo> NFO + poster next to it -- the only
// mechanism that gets a real title/artist/album into Tunarr's guide for this library type.
export async function materializeRenderForChannel(
  channelStorageDirectory: string,
  mediaItem: { id: string; title: string; artist: string | null; album: string | null; genre: string | null; releaseDate: Date | null; year: number | null; sourceThumbnailPath: string | null },
  renderedAsset: { outputPath: string | null; outputDurationSeconds: number | null }
) {
  if (!renderedAsset.outputPath || !(await exists(renderedAsset.outputPath))) {
    throw new AppError("RENDER_OUTPUT_MISSING", `The rendered file for "${mediaItem.title}" is missing on disk.`, 500);
  }
  await mkdir(channelStorageDirectory, { recursive: true });
  const target = path.join(channelStorageDirectory, `${mediaItem.id}.mp4`);
  if (!(await exists(target))) {
    try {
      await link(renderedAsset.outputPath, target);
    } catch {
      const temp = `${target}.${process.pid}.copying`;
      await copyFile(renderedAsset.outputPath, temp);
      await rename(temp, target);
    }
  }
  const nfoPath = path.join(channelStorageDirectory, `${mediaItem.id}.nfo`);
  await writeMusicVideoNfo(nfoPath, mediaItem);
  const posterPath = path.join(channelStorageDirectory, `${mediaItem.id}-poster.jpg`);
  const wrotePoster = mediaItem.sourceThumbnailPath ? await writePosterArtwork(posterPath, mediaItem.sourceThumbnailPath) : false;
  if (!wrotePoster) {
    await grabFallbackPoster(target, posterPath, renderedAsset.outputDurationSeconds ?? 10).catch(() => {});
  }
  return target;
}
