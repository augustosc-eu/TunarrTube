import { describe, expect, it } from "vitest";
import { addCollectionVideosSchema, aiProviderOverrideSchema, aiProviderSettingSchema, analyzeSourceSchema, createSourceSchema, createTemplateSchema, directorPreviewSchema, logsPurgeSchema, patchSourceSchema, settingsSchema } from "@/lib/validation";

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
  it("validates log retention and purge settings", () => {
    expect(settingsSchema.parse({ logRetentionDays: 14 }).logRetentionDays).toBe(14);
    expect(() => settingsSchema.parse({ logRetentionDays: 0 })).toThrow();
    expect(logsPurgeSchema.parse({}).action).toBe("purge");
    expect(logsPurgeSchema.parse({ action: "clear" }).action).toBe("clear");
  });
  it("validates batches of individual video URLs", () => {
    expect(addCollectionVideosSchema.parse({ urls: ["https://youtu.be/rtX9Fof1muY"] }).urls).toHaveLength(1);
    expect(() => addCollectionVideosSchema.parse({ urls: [] })).toThrow();
  });
  it("accepts a valid naming scheme override and rejects an unknown one", () => {
    expect(settingsSchema.parse({ defaultNamingScheme: "tvshow" }).defaultNamingScheme).toBe("tvshow");
    expect(() => settingsSchema.parse({ defaultNamingScheme: "bogus" })).toThrow();
    expect(patchSourceSchema.parse({ namingScheme: "template", filenameTemplate: "{channel} - {title}" }).filenameTemplate).toBe("{channel} - {title}");
    expect(patchSourceSchema.parse({ namingScheme: null }).namingScheme).toBeNull();
    expect(() => patchSourceSchema.parse({ filenameTemplate: "" })).toThrow();
  });
  it("accepts \"claude-code\" as an AI provider choice everywhere the other two providers are accepted", () => {
    expect(aiProviderSettingSchema.parse("claude-code")).toBe("claude-code");
    expect(aiProviderOverrideSchema.parse("claude-code")).toBe("claude-code");
    expect(() => aiProviderOverrideSchema.parse("ollama")).toThrow();
  });
  it("validates the local Claude Code settings fields (enable switch, path, timeout bounds)", () => {
    const parsed = settingsSchema.parse({ aiClaudeCodeEnabled: true, aiClaudeCodePath: "/usr/local/bin/claude", aiClaudeCodeTimeoutSeconds: 90 });
    expect(parsed).toMatchObject({ aiClaudeCodeEnabled: true, aiClaudeCodePath: "/usr/local/bin/claude", aiClaudeCodeTimeoutSeconds: 90 });
    expect(settingsSchema.parse({ aiClaudeCodePath: null }).aiClaudeCodePath).toBeNull();
    expect(() => settingsSchema.parse({ aiClaudeCodeTimeoutSeconds: 5 })).toThrow();
    expect(() => settingsSchema.parse({ aiClaudeCodeTimeoutSeconds: 601 })).toThrow();
  });
  it("validates an AI Programming Director preview request", () => {
    const parsed = directorPreviewSchema.parse({ instructions: "Program the evening block.", scheduleStyle: "daily-dayparts", aiProvider: "claude-code" });
    expect(parsed.scheduleStyle).toBe("daily-dayparts");
    expect(() => directorPreviewSchema.parse({ instructions: "", scheduleStyle: "daily-dayparts" })).toThrow();
    expect(() => directorPreviewSchema.parse({ instructions: "x", scheduleStyle: "bogus" })).toThrow();
  });
  it("bounds template field sizes -- a direct API call bypasses the visual editor's client-side image-size check", () => {
    const base = { name: "Test", htmlTemplate: "<div></div>", bindingsJson: "[]", layersJson: "[]" };
    expect(createTemplateSchema.parse(base).htmlTemplate).toBe("<div></div>");
    expect(() => createTemplateSchema.parse({ ...base, htmlTemplate: "a".repeat(8_000_001) })).toThrow();
    expect(() => createTemplateSchema.parse({ ...base, visualLayoutJson: "a".repeat(8_000_001) })).toThrow();
    expect(() => createTemplateSchema.parse({ ...base, bindingsJson: "a".repeat(100_001) })).toThrow();
    expect(() => createTemplateSchema.parse({ ...base, layersJson: "a".repeat(100_001) })).toThrow();
  });
});
