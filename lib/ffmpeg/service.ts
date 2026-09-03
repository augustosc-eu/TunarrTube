import { AppError } from "@/lib/api";
import { discoverBinary, inspectBinary } from "@/lib/system/binaries";

export async function requireFfmpeg() {
  const binary = await discoverBinary("ffmpeg");
  if (!binary) throw new AppError("FFMPEG_NOT_FOUND", "FFmpeg was not found. Install it or set YTARR_FFMPEG_PATH.", 503);
  return binary;
}

export async function testFfmpeg() {
  return inspectBinary("ffmpeg");
}
