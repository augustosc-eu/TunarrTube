import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOverlayFilterGraph, renderVideoWithOverlay } from "@/lib/ffmpeg/compose";

// requireFfmpeg/runProcess shell out to a real binary and a real process -- stubbed here so this test
// exercises only the argument construction, same convention as the rest of tests/ (fetch/child_process
// stubbed via vi.stubGlobal/vi.mock rather than exercised for real). runProcess is stubbed to not
// actually write the temp file renderVideoWithOverlay then renames into place, so rename is stubbed too.
vi.mock("@/lib/ffmpeg/service", () => ({ requireFfmpeg: vi.fn(async () => "ffmpeg") }));
const runProcess = vi.fn(async (_program: string, _args: string[], _options?: unknown) => ({ stdout: "", stderr: "", code: 0 }));
// vi.mock() factories are hoisted above this file's own top-level declarations, so the factory can't
// reference `runProcess` directly (a TDZ error at import time) -- routing the call through a plain
// wrapper defers that reference until the mock is actually invoked, by which point the module has
// finished loading.
vi.mock("@/lib/system/process", () => ({ runProcess: (program: string, args: string[], options?: unknown) => runProcess(program, args, options) }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(async () => undefined) };
});

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

describe("renderVideoWithOverlay", () => {
  afterEach(() => runProcess.mockClear());

  it("bounds the output with an explicit -t alongside -shortest, so a source with no audio track still terminates at the real duration", async () => {
    // -shortest alone only bounds the output against another *mapped* stream (normally the source's
    // audio track); a source with no audio has nothing to shorten against, and the video stream is
    // otherwise unbounded (each overlay layer is a "-loop 1" PNG input, i.e. infinite duration) -- see
    // lib/ffmpeg/compose.ts. Passing the real, ffprobe'd duration explicitly closes that gap.
    const outDir = await mkdtemp(path.join(os.tmpdir(), "ytarr-compose-test-"));
    try {
      await renderVideoWithOverlay(
        "/tmp/source.mp4",
        [{ pngPath: "/tmp/layer.png", timing: { startSec: 0, durationSec: 12.5, fadeInMs: 300, fadeOutMs: 300 } }],
        path.join(outDir, "out.mp4"),
        { videoWidth: 1920, videoHeight: 1080, audioCodec: null, durationSeconds: 12.5 }
      );
      expect(runProcess).toHaveBeenCalledTimes(1);
      const args = runProcess.mock.calls[0][1];
      const tIndex = args.indexOf("-t");
      expect(tIndex).toBeGreaterThan(-1);
      expect(args[tIndex + 1]).toBe("12.5");
      expect(args).toContain("-shortest");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
