// The visual drag-and-drop builder's own data shape -- a template edited this way stores one of
// these as OverlayTemplate.visualLayoutJson, and lib/overlay/visual.ts generates the actual
// htmlTemplate/bindingsJson from it. See components/template-visual-editor.tsx.

export type VisualElement = {
  id: string;
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
};

export type VisualLayout = {
  canvasWidth: number;
  canvasHeight: number;
  elements: VisualElement[];
};
