import type { BindingField, OverlayLayer } from "@/lib/overlay/types";

export const MUSIC_VIDEO_LOWER_THIRD_HTML = `<!doctype html>
<html><head><style>
  html, body { width: 100%; height: 100%; margin: 0; }
  .wrap { position: relative; width: 100%; height: 100%; font-family: 'Helvetica Neue', Arial, sans-serif; }
  .card {
    position: absolute; left: 64px; bottom: 72px; max-width: 62%;
    display: flex; align-items: stretch; border-radius: 10px; overflow: hidden;
    background: rgba(10, 12, 18, 0.72); box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
  }
  .accent-bar { width: 6px; background: linear-gradient(180deg, #a78bfa, #7c3aed); flex: 0 0 auto; }
  .text { padding: 14px 22px; color: #fff; }
  .artist { font-size: 30px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.2; text-shadow: 0 2px 8px rgba(0,0,0,0.5); }
  .title { font-size: 22px; font-weight: 500; opacity: 0.92; margin-top: 2px; }
  .album { font-size: 15px; font-weight: 400; opacity: 0.7; margin-top: 4px; }
</style></head>
<body><div class="wrap">
  <div class="card">
    <div class="accent-bar"></div>
    <div class="text">
      <div class="artist">{{artist}}</div>
      <div class="title">{{title}}</div>
      <div class="album">{{album}}</div>
    </div>
  </div>
</div></body></html>`;

export const MUSIC_VIDEO_BINDINGS: BindingField[] = [
  { key: "artist", label: "Artist", type: "text", sampleValue: "Artist Name" },
  { key: "title", label: "Song title", type: "text", sampleValue: "Song Title" },
  { key: "album", label: "Album", type: "text", sampleValue: "Album Name" }
];

export const MUSIC_VIDEO_LAYERS: OverlayLayer[] = [{
  id: "lower-third",
  name: "Lower third",
  canvasWidth: 1920,
  canvasHeight: 1080,
  timing: { startSec: 2, durationSec: 8, fadeInMs: 500, fadeOutMs: 500 }
}];

export const MUSIC_VIDEO_TEMPLATE = {
  name: "Music Video Lower Third",
  channelType: "music_video",
  description: "Artist/title/album card in the bottom-left corner, fading in for the first several seconds.",
  html: MUSIC_VIDEO_LOWER_THIRD_HTML,
  bindings: MUSIC_VIDEO_BINDINGS,
  layers: MUSIC_VIDEO_LAYERS
};
