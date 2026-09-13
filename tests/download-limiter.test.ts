import { describe, expect, it } from "vitest";
import { withDownloadPermit } from "@/lib/downloads/limiter";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("download limiter", () => {
  it("serializes media fetches across independent callers", async () => {
    const firstStarted = deferred();
    const releaseFirst = deferred();
    let secondStarted = false;

    const first = withDownloadPermit(async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
    });
    await firstStarted.promise;
    const second = withDownloadPermit(async () => { secondStarted = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(secondStarted).toBe(false);

    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(secondStarted).toBe(true);
  });
});
