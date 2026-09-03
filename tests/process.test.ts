import { describe, expect, it } from "vitest";
import { runProcess, safeCommand } from "@/lib/system/process";

describe("safe process execution", () => {
  it("passes arguments without shell interpolation", async () => {
    const result = await runProcess(process.execPath, ["-e", "process.stdout.write(process.argv[1])", "$(echo unsafe)"]);
    expect(result.stdout).toBe("$(echo unsafe)");
  });

  it("redacts signed playback URLs from printable commands", () => {
    expect(safeCommand("yt-dlp", ["https://r1.googlevideo.com/videoplayback?sig=secret"])).toBe("yt-dlp [redacted-url]");
  });

  it("returns useful failures", async () => {
    await expect(runProcess(process.execPath, ["-e", "process.stderr.write('broken'); process.exit(2)"])).rejects.toThrow(/broken/);
  });
});
