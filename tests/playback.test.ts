import { describe, expect, it } from "vitest";
import { parseRange } from "@/lib/playback/service";

describe("playback byte ranges", () => {
  it("parses bounded, open, and suffix ranges", () => {
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });
  it("rejects malformed and unsatisfiable ranges", () => {
    expect(() => parseRange("items=0-2", 100)).toThrow(/Invalid byte range/);
    expect(() => parseRange("bytes=100-101", 100)).toThrow(/outside/);
  });
});
