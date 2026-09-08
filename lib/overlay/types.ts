export type BindingField = {
  key: string; // matches a {{key}} placeholder in the template HTML
  label: string;
  type: "text" | "number" | "date";
  sampleValue: string;
  // Text to render instead of a blank string when the resolved real value (custom field, then
  // built-in MediaItem column) comes back empty. Unset means stay blank -- the pre-existing
  // behavior. Never used in the template editor's own placeholder preview, which always shows
  // sampleValue regardless; only resolveBindingValues (a real render) applies it.
  fallback?: string;
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
