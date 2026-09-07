// The visual drag-and-drop builder's own data shape -- a template edited this way stores one of
// these as OverlayTemplate.visualLayoutJson, and lib/overlay/visual.ts generates the actual
// htmlTemplate/bindingsJson from it. See components/template-visual-editor.tsx.

export type VisualElement = {
  id: string;
  // "text" when absent -- every layout saved before image elements shipped has no `kind` at all.
  kind?: "text" | "image";
  bindingKey: string;
  label?: string;
  sampleValue?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontWeight: 400 | 700;
  color: string;
  align: "left" | "center" | "right";
  background?: string;
  padding: number;
  borderRadius: number;
  // kind: "image" only. A data: URI (the image is inlined straight into htmlTemplate, so a template
  // stays one self-contained JSON blob with no separate asset storage/serving to manage). Rendering
  // is one static Puppeteer screenshot per layer (lib/overlay/service.ts:renderOverlayLayers) -- an
  // animated GIF freezes on whichever frame the browser paints first, it will not play.
  src?: string;
  opacity?: number; // 0-1, default 1
};

export type VisualLayout = {
  canvasWidth: number;
  canvasHeight: number;
  elements: VisualElement[];
};
