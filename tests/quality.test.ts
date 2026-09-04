import { describe, expect, it } from "vitest";
import { downloadFormatSelector, resolveEffectiveQuality, streamFormatSelector } from "@/lib/youtube/quality";

describe("video quality", () => {
  it("reproduces the original fixed selectors for the best preset", () => {
    expect(downloadFormatSelector("best")).toBe("bv*[vcodec^=avc]+ba[acodec^=mp4a]/b[ext=mp4]/best");
    expect(streamFormatSelector("best")).toBe("b[ext=mp4][vcodec^=avc][acodec^=mp4a]/b[ext=mp4]/best");
  });

  it("caps download selectors at the requested height with a graceful fallback chain", () => {
    const selector = downloadFormatSelector("1080p");
    expect(selector).toBe("bv*[vcodec^=avc][height<=1080]+ba[acodec^=mp4a]/b[ext=mp4][height<=1080]/bv*[height<=1080]+ba/b[height<=1080]/best[height<=1080]/best");
  });

  it("caps stream selectors at the requested height with a graceful fallback chain", () => {
    const selector = streamFormatSelector("720p");
    expect(selector).toBe("b[ext=mp4][vcodec^=avc][acodec^=mp4a][height<=720]/b[ext=mp4][height<=720]/b[height<=720]/best[height<=720]/best");
  });

  it("prefers a valid per-source override over the global default", () => {
    expect(resolveEffectiveQuality("480p", "best")).toBe("480p");
  });

  it("falls back to the global default when there is no override", () => {
    expect(resolveEffectiveQuality(null, "1440p")).toBe("1440p");
    expect(resolveEffectiveQuality(undefined, "1440p")).toBe("1440p");
  });

  it("falls back to best when neither value is a recognized preset", () => {
    expect(resolveEffectiveQuality("garbage", "also-garbage")).toBe("best");
  });
});
