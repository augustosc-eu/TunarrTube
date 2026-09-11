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

  it("writes stdin text to the child and closes it, for a payload too large to safely pass as an argv element", async () => {
    const large = "y".repeat(500_000);
    const result = await runProcess(process.execPath, ["-e", "process.stdout.write(String(require('fs').readFileSync(0, 'utf8').length))"], { stdin: large });
    expect(result.stdout).toBe(String(large.length));
  });

  it("closes stdin immediately (no hang) when no stdin option is given, same as before this option existed", async () => {
    const result = await runProcess(process.execPath, ["-e", "process.stdout.write(String(require('fs').readFileSync(0, 'utf8').length))"]);
    expect(result.stdout).toBe("0");
  });
});
