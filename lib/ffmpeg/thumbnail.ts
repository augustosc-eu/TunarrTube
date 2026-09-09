import path from "node:path";
import { mkdir, rename } from "node:fs/promises";
import { requireFfmpeg } from "@/lib/ffmpeg/service";
import { runProcess } from "@/lib/system/process";

// Grabs a single JPEG frame from `sourcePath` at `atSeconds` -- used to give a rendered asset a
// preview image without re-decoding the whole file client-side. Same temp-then-rename pattern as
// renderVideoWithOverlay so a crash mid-extract never leaves a half-written file at the real path.
export async function extractVideoFrame(sourcePath: string, outputPath: string, atSeconds: number, signal?: AbortSignal): Promise<void> {
  const ffmpeg = await requireFfmpeg();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const tempOutput = `${outputPath}.${process.pid}.tmp.jpg`;
  await runProcess(ffmpeg, [
    "-y",
    "-ss", String(Math.max(0, atSeconds)),
    "-i", sourcePath,
    "-frames:v", "1",
    "-q:v", "4",
    tempOutput
  ], { timeoutMs: 60_000, signal });
  await rename(tempOutput, outputPath);
}
