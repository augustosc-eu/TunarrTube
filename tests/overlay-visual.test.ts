import { describe, expect, it } from "vitest";
import { layoutToBindings, renderLayoutToHtml } from "@/lib/overlay/visual";
import type { VisualLayout } from "@/lib/overlay/visual-types";

const TEXT_ELEMENT = {
  id: "el-text", bindingKey: "title", label: "Title", sampleValue: "Sample Title",
  x: 10, y: 10, width: 200, height: 40,
  fontSize: 24, fontWeight: 700 as const, color: "#ffffff",
  align: "left" as const, padding: 8, borderRadius: 4
};

const IMAGE_ELEMENT = {
  id: "el-image", kind: "image" as const, bindingKey: "",
  x: 20, y: 20, width: 100, height: 100,
  fontSize: 16, fontWeight: 400 as const, color: "#ffffff",
  align: "left" as const, padding: 0, borderRadius: 0,
  src: "data:image/png;base64,AAA=", opacity: 0.5
};

describe("renderLayoutToHtml", () => {
  it("renders a text element as a binding-driven div", () => {
    const layout: VisualLayout = { canvasWidth: 1920, canvasHeight: 1080, elements: [TEXT_ELEMENT] };
    const html = renderLayoutToHtml(layout);
    expect(html).toContain("{{title}}");
    expect(html).not.toContain("<img");
  });

  it("renders an image element as an <img> tag carrying its data URI and opacity, with no binding placeholder", () => {
    const layout: VisualLayout = { canvasWidth: 1920, canvasHeight: 1080, elements: [IMAGE_ELEMENT] };
    const html = renderLayoutToHtml(layout);
    expect(html).toContain('<img src="data:image/png;base64,AAA="');
    expect(html).toContain("opacity:0.5");
    expect(html).not.toContain("{{");
  });

  it("treats an element with no kind as text, for layouts saved before image elements shipped", () => {
    const legacyElement = { ...TEXT_ELEMENT };
    // @ts-expect-error kind is intentionally absent, matching a pre-existing stored layout
    delete legacyElement.kind;
    const layout: VisualLayout = { canvasWidth: 1920, canvasHeight: 1080, elements: [legacyElement] };
    expect(renderLayoutToHtml(layout)).toContain("{{title}}");
  });
});

describe("layoutToBindings", () => {
  it("excludes image elements from the binding list", () => {
    const layout: VisualLayout = { canvasWidth: 1920, canvasHeight: 1080, elements: [TEXT_ELEMENT, IMAGE_ELEMENT] };
    const bindings = layoutToBindings(layout);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].key).toBe("title");
  });
});
