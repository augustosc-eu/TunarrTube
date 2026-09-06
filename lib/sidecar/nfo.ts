import { constants } from "node:fs";
import { access, copyFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireFfmpeg } from "@/lib/ffmpeg/service";
import { runProcess } from "@/lib/system/process";

async function exists(file: string) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Tunarr's "music_videos" local media scanner reads a Kodi-style <musicvideo> NFO sidecar (same
// basename as the video, ".nfo" extension) for title/artist/album/plot -- see
// https://tunarr.com/configure/media_sources/local/music_videos/. Verified against a live Tunarr
// 1.3.14 that a <musicvideo> NFO present but missing <artist> makes Tunarr's scanner silently
// drop the whole file from the library (not just fall back to the filename), so <artist> is
// always emitted, defaulting to "Unknown Artist" the same way Kodi/Plex/Jellyfin scanners do for
// untagged local files.
export function buildMusicVideoNfo(item: {
  title: string;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  releaseDate?: Date | null;
  year?: number | null;
}) {
  const lines = ["<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>", "<musicvideo>", `  <title>${xmlEscape(item.title)}</title>`, `  <artist>${xmlEscape(item.artist || "Unknown Artist")}</artist>`];
  if (item.album) lines.push(`  <album>${xmlEscape(item.album)}</album>`);
  if (item.genre) lines.push(`  <genre>${xmlEscape(item.genre)}</genre>`);
  if (item.releaseDate) lines.push(`  <premiered>${item.releaseDate.toISOString().slice(0, 10)}</premiered>`);
  if (item.year) lines.push(`  <year>${item.year}</year>`);
  lines.push("</musicvideo>");
  return `${lines.join("\n")}\n`;
}

export async function writeMusicVideoNfo(target: string, item: Parameters<typeof buildMusicVideoNfo>[0]) {
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, buildMusicVideoNfo(item), "utf8");
  await rename(temp, target);
}

export async function writePosterArtwork(target: string, sourceImagePath: string) {
  if (!(await exists(sourceImagePath))) return false;
  const temp = `${target}.${process.pid}.tmp`;
  await copyFile(sourceImagePath, temp);
  await rename(temp, target);
  return true;
}

// Best-effort fallback when no MusicBrainz/iTunes artwork was applied: grab a frame from the
// middle of the rendered clip so Tunarr's guide/library still has *some* artwork.
export async function grabFallbackPoster(videoPath: string, target: string, durationSeconds: number) {
  const ffmpeg = await requireFfmpeg();
  const midpoint = Math.max(1, Math.floor(durationSeconds / 2));
  const temp = `${target}.${process.pid}.tmp${path.extname(target)}`;
  await runProcess(ffmpeg, ["-y", "-ss", String(midpoint), "-i", videoPath, "-frames:v", "1", "-q:v", "3", temp], { timeoutMs: 30_000 });
  await rename(temp, target);
}
