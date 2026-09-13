import { describe, expect, it } from "vitest";
import { parseMusicTitle } from "@/lib/metadata-lookup/title-parse";

describe("parseMusicTitle", () => {
  it("splits the 'Artist - Title' convention", () => {
    expect(parseMusicTitle("Fujii Kaze - It's Alright")).toEqual({ artist: "Fujii Kaze", title: "It's Alright" });
  });

  it("strips a trailing '(Official ... Video)' annotation before splitting", () => {
    expect(parseMusicTitle("Fujii Kaze - It's Alright [Official Video]")).toEqual({ artist: "Fujii Kaze", title: "It's Alright" });
    expect(parseMusicTitle("Fujii Kaze - Casket Girl  (Official Music Video)")).toEqual({ artist: "Fujii Kaze", title: "Casket Girl" });
  });

  it("strips a bare trailing 'MV' and a following noise-only parenthetical", () => {
    expect(parseMusicTitle("Fujii Kaze - 'You' MV (Test)")).toEqual({ artist: "Fujii Kaze", title: "You" });
  });

  it("strips '(Behind The Scenes)'", () => {
    expect(parseMusicTitle("Fujii Kaze - Hachikō (Behind The Scenes)")).toEqual({ artist: "Fujii Kaze", title: "Hachikō" });
  });

  it("strips full-width brackets used in Japanese/Korean titles", () => {
    expect(parseMusicTitle("Fujii Kaze - I Need U Back ❤︎ （Behind The Scenes）")).toEqual({ artist: "Fujii Kaze", title: "I Need U Back ❤︎" });
  });

  it("leaves an annotation alone when it isn't only noise words", () => {
    // "Instrumental" is real information about the recording, not filler -- don't discard it.
    expect(parseMusicTitle("Fujii Kaze - masshiro (pure white) [Instrumental - Official Audio]"))
      .toEqual({ artist: "Fujii Kaze", title: "masshiro (pure white) [Instrumental - Official Audio]" });
  });

  it("returns the title unsplit when there's no 'Artist - Title' shape", () => {
    expect(parseMusicTitle("Some Song")).toEqual({ title: "Some Song" });
  });

  it("falls back to the cleaned title when the dash-split right side is only quote marks", () => {
    expect(parseMusicTitle("Fujii Kaze - ''")).toEqual({ title: "Fujii Kaze - ''" });
  });
});
