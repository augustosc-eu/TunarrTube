export type BindingField = {
  key: string; // matches a {{key}} placeholder in the template HTML
  label: string;
  type: "text" | "number" | "date";
  sampleValue: string;
};

export type OverlayLayerTiming = {
  startSec: number;
  durationSec: number;
  fadeInMs: number;
  fadeOutMs: number;
};

export type OverlayLayer = {
  id: string;
  name: string;
  canvasWidth: number;
  canvasHeight: number;
  timing: OverlayLayerTiming;
};
