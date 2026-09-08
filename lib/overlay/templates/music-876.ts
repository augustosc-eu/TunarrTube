import type { BindingField, OverlayLayer } from "@/lib/overlay/types";

// Recreates the look of the old make_876_overlays.sh ffmpeg script (a black card + cyan underline,
// bold title over a regular-weight artist line) as a proper template: same box/bar/text geometry,
// computed at the same absolute pixel positions the script used against a 1920x1080 source, but
// bound to {{title}}/{{artist}} instead of a filename split -- see BUILT_IN_FIELD_ALIASES in
// lib/overlay/service.ts, which already maps both straight onto MediaItem.title/MediaItem.artist.
export const MUSIC_876_LOWER_THIRD_HTML = `<!doctype html>
<html><head><style>
  html, body { width: 100%; height: 100%; margin: 0; }
  .wrap { position: relative; width: 100%; height: 100%; font-family: Arial, 'Helvetica Neue', sans-serif; }
  .card { position: absolute; left: 70px; top: 870px; width: 760px; height: 120px; background: rgba(0, 0, 0, 0.45); }
  .accent { position: absolute; left: 70px; top: 988px; width: 220px; height: 6px; background: rgba(0, 229, 255, 0.95); }
  .title { position: absolute; left: 95px; top: 892px; font-size: 42px; font-weight: 700; color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,0.6); }
  .artist { position: absolute; left: 95px; top: 948px; font-size: 30px; font-weight: 400; color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,0.6); }
</style></head>
<body><div class="wrap">
  <div class="card"></div>
  <div class="accent"></div>
  <div class="title">{{title}}</div>
  <div class="artist">{{artist}}</div>
</div></body></html>`;

export const MUSIC_876_BINDINGS: BindingField[] = [
  { key: "title", label: "Song title", type: "text", sampleValue: "Song Title" },
  { key: "artist", label: "Artist", type: "text", sampleValue: "Artist Name", fallback: "UNKNOWN ARTIST" }
];

// startSec:5/durationSec:8 matches the script's enable='between(t,5,13)' window exactly. Unlike the
// script's hard cut, a short fade is added (see buildOverlayFilterGraph in lib/ffmpeg/compose.ts) --
// a deliberate small deviation for a less jarring pop-in/out; set both to 0 for an identical hard cut.
export const MUSIC_876_LAYERS: OverlayLayer[] = [{
  id: "876-lower-third",
  name: "876 lower third",
  canvasWidth: 1920,
  canvasHeight: 1080,
  timing: { startSec: 5, durationSec: 8, fadeInMs: 250, fadeOutMs: 250 }
}];

export const MUSIC_876_TEMPLATE = {
  name: "87.6 Music Lower Third",
  channelType: "music_video",
  description: "Black card with a cyan underline, bold title over a regular-weight artist line -- matches the old make_876_overlays.sh look.",
  html: MUSIC_876_LOWER_THIRD_HTML,
  bindings: MUSIC_876_BINDINGS,
  layers: MUSIC_876_LAYERS
};
