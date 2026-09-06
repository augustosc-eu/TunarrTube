import { describe, expect, it } from "vitest";
import { buildOverlayFilterGraph } from "@/lib/ffmpeg/compose";

describe("buildOverlayFilterGraph", () => {
  it("builds one scale+fade stage and one overlay stage per layer, chained in order", () => {
    const graph = buildOverlayFilterGraph(
      [
        { pngInputIndex: 1, timing: { startSec: 2, durationSec: 8, fadeInMs: 500, fadeOutMs: 500 } },
        { pngInputIndex: 2, timing: { startSec: 1, durationSec: 12, fadeInMs: 400, fadeOutMs: 400 } }
      ],
      1920,
      1080
    );
    const stages = graph.split(";\n");
    expect(stages).toHaveLength(4);

    // Scale+fade stages first, one per PNG input, referencing that input's own index.
    expect(stages[0]).toContain("[1:v]scale=1920:1080");
    expect(stages[0]).toContain("fade=t=in:st=2:d=0.5:alpha=1");
    expect(stages[0]).toContain("fade=t=out:st=9.5:d=0.5:alpha=1[ov1]");
    expect(stages[1]).toContain("[2:v]scale=1920:1080");

    // Overlay stages chain sequentially: the source video first, each subsequent stage building on
    // the previous stage's output label, the last one landing on "vout".
    expect(stages[2]).toBe("[0:v][ov1]overlay=0:0:enable='between(t,2,10)'[v0]");
    expect(stages[3]).toBe("[v0][ov2]overlay=0:0:enable='between(t,1,13)'[vout]");
  });

  it("clamps the fade-out start so it never starts before the layer's own fade-in", () => {
    // durationSec (1s) is shorter than fadeOutMs (2s) would imply on its own -- the fade-out start
    // must still be clamped to no earlier than startSec, not go negative relative to it.
    const graph = buildOverlayFilterGraph(
      [{ pngInputIndex: 1, timing: { startSec: 5, durationSec: 1, fadeInMs: 100, fadeOutMs: 2000 } }],
      1280,
      720
    );
    expect(graph).toContain("fade=t=out:st=5:d=2:alpha=1");
  });
});
