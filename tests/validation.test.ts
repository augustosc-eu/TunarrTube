import { describe, expect, it } from "vitest";
import { addCollectionVideosSchema, analyzeSourceSchema, createSourceSchema, settingsSchema } from "@/lib/validation";

describe("Phase 2 validation", () => {
  it("accepts channel analysis and all playback modes", () => {
    expect(analyzeSourceSchema.parse({ url: "https://youtube.com/@example", feedType: "all", historyLimit: null }).feedType).toBe("all");
    expect(createSourceSchema.parse({ draftId: "draft", playbackMode: "cache" }).syncIntervalMinutes).toBe(360);
    expect(createSourceSchema.parse({ draftId: "draft", playbackMode: "stream" }).playbackMode).toBe("stream");
  });
  it("rejects unsafe cache and scheduler settings", () => {
    expect(() => settingsSchema.parse({ cacheMaxMegabytes: 10 })).toThrow();
    expect(() => createSourceSchema.parse({ draftId: "draft", syncIntervalMinutes: 5 })).toThrow();
  });
  it("validates batches of individual video URLs", () => {
    expect(addCollectionVideosSchema.parse({ urls: ["https://youtu.be/rtX9Fof1muY"] }).urls).toHaveLength(1);
    expect(() => addCollectionVideosSchema.parse({ urls: [] })).toThrow();
  });
});
