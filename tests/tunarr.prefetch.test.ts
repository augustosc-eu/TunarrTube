import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), materialize: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: { source: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/downloads/service", () => ({
  materializeForTunarr: mocks.materialize,
  VideoUnavailableError: class extends Error {}
}));

import { publishSourceToTunarr } from "@/lib/tunarr/service";

it("passes cancellation to prefetch and stops before the next video or Tunarr request", async () => {
  const controller = new AbortController();
  mocks.findUnique.mockResolvedValue({
    id: "source", playbackMode: "cache",
    videos: [{ videoId: "first" }, { videoId: "second" }]
  });
  mocks.materialize.mockImplementation(async (_source, _video, signal: AbortSignal) => {
    expect(signal).toBe(controller.signal);
    controller.abort();
    signal.throwIfAborted();
  });
  await expect(publishSourceToTunarr("source", {
    channelName: "Test", programmingOrder: "playlist"
  }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.materialize).toHaveBeenCalledTimes(1);
});
