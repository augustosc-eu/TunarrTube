import { AppError } from "@/lib/api";
import { requireFfprobe } from "@/lib/ffmpeg/ffprobe-binary";
import { runProcess } from "@/lib/system/process";

export type MediaInfo = {
  width: number | null;
  height: number | null;
  durationSeconds: number;
  videoCodec: string | null;
  audioCodec: string | null;
};

type FfprobeStream = { codec_type?: string; codec_name?: string; width?: number; height?: number };
type FfprobeOutput = { streams?: FfprobeStream[]; format?: { duration?: string } };

export async function ffprobeMediaInfo(filePath: string, signal?: AbortSignal): Promise<MediaInfo> {
  const ffprobe = await requireFfprobe();
  const result = await runProcess(ffprobe, [
    "-v", "error",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    filePath
  ], { timeoutMs: 60_000, signal });

  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new AppError("FFPROBE_INVALID_OUTPUT", "ffprobe did not return valid JSON for this file.", 500);
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const durationSeconds = Number(parsed.format?.duration ?? 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new AppError("FFPROBE_NO_DURATION", "Could not determine the duration of this file.", 500);
  }

  return {
    width: video?.width ?? null,
    height: video?.height ?? null,
    durationSeconds,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null
  };
}
