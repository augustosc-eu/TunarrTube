import type { BindingField } from "@/lib/overlay/types";
import type { VisualElement, VisualLayout } from "@/lib/overlay/visual-types";

function titleCase(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.length ? spaced.replace(/\b\w/g, (char) => char.toUpperCase()) : key;
}

function elementStyle(element: VisualElement): string {
  return [
    "position:absolute",
    `left:${element.x}px`,
    `top:${element.y}px`,
    `width:${element.width}px`,
    `height:${element.height}px`,
    `font-size:${element.fontSize}px`,
    `font-weight:${element.fontWeight}`,
    `color:${element.color}`,
    `text-align:${element.align}`,
    `padding:${element.padding}px`,
    `border-radius:${element.borderRadius}px`,
    element.background ? `background:${element.background}` : "",
    "box-sizing:border-box",
    "overflow:hidden",
    "font-family:'Helvetica Neue', Arial, sans-serif"
  ].filter(Boolean).join("; ");
}

// Generates the same kind of self-contained, absolutely-positioned HTML the renderer already
// consumes (lib/overlay/puppeteer.ts / lib/ffmpeg/compose.ts need no changes for this). The visual
// builder is the source of truth for a template's design once it has a layout; this output always
// replaces htmlTemplate wholesale rather than patching it.
export function renderLayoutToHtml(layout: VisualLayout): string {
  const elements = layout.elements
    .map((element) => `  <div style="${elementStyle(element)}">{{${element.bindingKey}}}</div>`)
    .join("\n");
  return `<!doctype html>
<html><head><style>
  html, body { width: 100%; height: 100%; margin: 0; }
</style></head>
<body><div style="position: relative; width: 100%; height: 100%;">
${elements}
</div></body></html>`;
}

// Derives the template's binding list straight from the layout -- each element carries its own
// label/sampleValue, so this is the single source of truth in visual mode (the Bindings JSON panel
// goes read-only whenever a layout is present; see components/template-editor.tsx).
export function layoutToBindings(layout: VisualLayout): BindingField[] {
  const seen = new Set<string>();
  const bindings: BindingField[] = [];
  for (const element of layout.elements) {
    if (!element.bindingKey || seen.has(element.bindingKey)) continue;
    seen.add(element.bindingKey);
    bindings.push({
      key: element.bindingKey,
      label: element.label?.trim() || titleCase(element.bindingKey),
      type: "text",
      sampleValue: element.sampleValue?.trim() || titleCase(element.bindingKey)
    });
  }
  return bindings;
}
