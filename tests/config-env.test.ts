import { afterEach, describe, expect, it, vi } from "vitest";
import { legacyEnvironmentInUse, readEnv } from "@/lib/config/env";

afterEach(() => vi.unstubAllEnvs());

describe("environment variables", () => {
  it("prefers the TUNARRTUBE_ name and falls back to the pre-rename YTARR_ name", () => {
    vi.stubEnv("TUNARRTUBE_THUMBNAIL_DIR", undefined);
    vi.stubEnv("YTARR_THUMBNAIL_DIR", "/legacy/thumbs");
    expect(readEnv("THUMBNAIL_DIR")).toBe("/legacy/thumbs");
    vi.stubEnv("TUNARRTUBE_THUMBNAIL_DIR", "/current/thumbs");
    expect(readEnv("THUMBNAIL_DIR")).toBe("/current/thumbs");
  });

  it("reports legacy names in use, and which are shadowed by the new name", () => {
    for (const name of ["YTARR_YTDLP_PATH", "YTARR_MEDIA_DIR", "TUNARRTUBE_YTDLP_PATH", "TUNARRTUBE_MEDIA_DIR"]) vi.stubEnv(name, undefined);
    vi.stubEnv("YTARR_YTDLP_PATH", "/opt/yt-dlp");
    vi.stubEnv("YTARR_MEDIA_DIR", "/media");
    vi.stubEnv("TUNARRTUBE_MEDIA_DIR", "/media");
    vi.stubEnv("YTARR_SOMETHING_ELSE", "x");
    const inUse = legacyEnvironmentInUse();
    expect(inUse).toContainEqual({ legacy: "YTARR_YTDLP_PATH", current: "TUNARRTUBE_YTDLP_PATH", ignored: false });
    expect(inUse).toContainEqual({ legacy: "YTARR_MEDIA_DIR", current: "TUNARRTUBE_MEDIA_DIR", ignored: true });
    expect(inUse.map((item) => item.legacy)).not.toContain("YTARR_SOMETHING_ELSE");
  });
});
