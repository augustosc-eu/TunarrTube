import path from "node:path";
import { mkdir, rename } from "node:fs/promises";
import { requireFfmpeg } from "@/lib/ffmpeg/service";
import { runProcess } from "@/lib/system/process";
import type { OverlayLayerTiming } from "@/lib/overlay/types";

type LayerInput = { pngInputIndex: number; timing: OverlayLayerTiming };

// Each PNG is a `-loop 1` input sharing the same global clock as the source video (input 0), so
// the fade filter's own `st` times line up directly with the overlay `enable` window -- no
// separate local/global time conversion needed. Layers chain in order; each stage overlays onto
// the previous stage's output.
export function buildOverlayFilterGraph(layers: LayerInput[], videoWidth: number, videoHeight: number): string {
  const scaleFadeStages = layers.map(({ pngInputIndex, timing }) => {
    const fadeOutStart = Math.max(timing.startSec, timing.startSec + timing.durationSec - timing.fadeOutMs / 1000);
    return `[${pngInputIndex}:v]scale=${videoWidth}:${videoHeight},format=rgba,` +
      `fade=t=in:st=${timing.startSec}:d=${timing.fadeInMs / 1000}:alpha=1,` +
      `fade=t=out:st=${fadeOutStart}:d=${timing.fadeOutMs / 1000}:alpha=1[ov${pngInputIndex}]`;
  });

  const overlayStages: string[] = [];
  let previous = "0:v";
  layers.forEach(({ pngInputIndex, timing }, index) => {
    const output = index === layers.length - 1 ? `vout` : `v${index}`;
    const end = timing.startSec + timing.durationSec;
    overlayStages.push(`[${previous}][ov${pngInputIndex}]overlay=0:0:enable='between(t,${timing.startSec},${end})'[${output}]`);
    previous = output;
  });

  return [...scaleFadeStages, ...overlayStages].join(";\n");
}

export async function renderVideoWithOverlay(
  sourcePath: string,
  layerPngs: Array<{ pngPath: string; timing: OverlayLayerTiming }>,
  outputPath: string,
  opts: { videoWidth: number; videoHeight: number; audioCodec: string | null },
  signal?: AbortSignal
): Promise<void> {
  const ffmpeg = await requireFfmpeg();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const tempOutput = `${outputPath}.${process.pid}.tmp.mp4`;

  const layers: LayerInput[] = layerPngs.map((layer, index) => ({ pngInputIndex: index + 1, timing: layer.timing }));
  const filterGraph = buildOverlayFilterGraph(layers, opts.videoWidth, opts.videoHeight);
  const lastLabel = "vout";

  const inputArgs = layerPngs.flatMap((layer) => ["-loop", "1", "-i", layer.pngPath]);
  const audioArgs = opts.audioCodec === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"];

  await runProcess(ffmpeg, [
    "-y",
    "-i", sourcePath,
    ...inputArgs,
    "-filter_complex", filterGraph,
    "-map", `[${lastLabel}]`,
    "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    ...audioArgs,
    "-movflags", "+faststart",
    "-shortest",
    tempOutput
  ], { timeoutMs: 60 * 60_000, signal });

  await rename(tempOutput, outputPath);
}
