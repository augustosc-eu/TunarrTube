import { describe, expect, it } from "vitest";
import { fillTemplate } from "@/lib/overlay/bindings";
import { resolveBindingValues } from "@/lib/overlay/service";
import type { BindingField } from "@/lib/overlay/types";

describe("fillTemplate", () => {
  it("substitutes {{key}} placeholders and HTML-escapes the values", () => {
    const html = "<div>{{title}} by {{artist}}</div>";
    expect(fillTemplate(html, { title: "A & B", artist: "<Unknown>" })).toBe("<div>A &amp; B by &lt;Unknown&gt;</div>");
  });

  it("leaves an unmatched placeholder blank rather than throwing", () => {
    expect(fillTemplate("{{missing}}", {})).toBe("");
  });
});

describe("resolveBindingValues", () => {
  const bindings: BindingField[] = [
    { key: "artist", label: "Artist", type: "text", sampleValue: "Sample Artist" },
    { key: "title", label: "Title", type: "text", sampleValue: "Sample Title" },
    { key: "ticker", label: "Ticker", type: "text", sampleValue: "Sample Ticker" }
  ];

  it("prefers an explicit per-item custom field over the built-in column", () => {
    const values = resolveBindingValues(
      { title: "Real Title", artist: "Real Artist", album: null, genre: null, year: null, customFieldsJson: JSON.stringify({ artist: "Custom Artist" }) },
      bindings
    );
    expect(values.artist).toBe("Custom Artist");
    expect(values.title).toBe("Real Title");
  });

  it("falls back to the built-in MediaItem column, keeping a blank column blank rather than using the sample", () => {
    const values = resolveBindingValues(
      { title: "Real Title", artist: null, album: null, genre: null, year: null, customFieldsJson: null },
      bindings
    );
    expect(values.artist).toBe("");
  });

  it("uses the binding's own sampleValue only for keys with no built-in alias", () => {
    const values = resolveBindingValues(
      { title: "Real Title", artist: "Real Artist", album: null, genre: null, year: null, customFieldsJson: null },
      bindings
    );
    expect(values.ticker).toBe("Sample Ticker");
  });

  it("tolerates malformed customFieldsJson by treating it as empty", () => {
    const values = resolveBindingValues(
      { title: "Real Title", artist: "Real Artist", album: null, genre: null, year: null, customFieldsJson: "{not json" },
      bindings
    );
    expect(values.artist).toBe("Real Artist");
  });
});
