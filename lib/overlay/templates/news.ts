import type { BindingField, OverlayLayer } from "@/lib/overlay/types";

// "category" and "ticker" have no matching MediaItem column (unlike headline/byline, which reuse
// title/artist) -- they only ever get real per-item text from MediaItem.customFieldsJson (see
// resolveBindingValues in lib/overlay/service.ts), which is the point: this template proves the
// generic custom-fields path end to end, not just a relabeled music-video card.
export const NEWS_BREAKING_LOWER_THIRD_HTML = `<!doctype html>
<html><head><style>
  html, body { width: 100%; height: 100%; margin: 0; }
  .wrap { position: relative; width: 100%; height: 100%; font-family: 'Helvetica Neue', Arial, sans-serif; }
  .banner { position: absolute; left: 0; right: 0; bottom: 96px; display: flex; align-items: stretch; }
  .tag {
    background: #dc2626; color: #fff; font-weight: 800; font-size: 20px; letter-spacing: 0.06em;
    text-transform: uppercase; padding: 10px 22px; display: flex; align-items: center; flex: 0 0 auto;
  }
  .headline-box {
    background: rgba(10, 12, 18, 0.85); color: #fff; padding: 12px 26px; max-width: 68%;
    display: flex; flex-direction: column; justify-content: center;
  }
  .headline { font-size: 32px; font-weight: 700; line-height: 1.15; text-shadow: 0 2px 8px rgba(0,0,0,0.5); }
  .byline { font-size: 16px; font-weight: 400; opacity: 0.75; margin-top: 4px; }
  .ticker {
    position: absolute; left: 0; right: 0; bottom: 0; height: 48px; background: #111827; color: #fbbf24;
    display: flex; align-items: center; padding: 0 24px; font-size: 18px; font-weight: 600;
  }
</style></head>
<body><div class="wrap">
  <div class="banner">
    <div class="tag">{{category}}</div>
    <div class="headline-box">
      <div class="headline">{{headline}}</div>
      <div class="byline">{{byline}}</div>
    </div>
  </div>
  <div class="ticker">{{ticker}}</div>
</div></body></html>`;

export const NEWS_BINDINGS: BindingField[] = [
  { key: "headline", label: "Headline", type: "text", sampleValue: "Local Officials Announce New Initiative" },
  { key: "byline", label: "Byline / reporter", type: "text", sampleValue: "Reported by Jane Doe" },
  { key: "category", label: "Category tag", type: "text", sampleValue: "BREAKING" },
  { key: "ticker", label: "Ticker text", type: "text", sampleValue: "More coverage at the top of the hour..." }
];

export const NEWS_LAYERS: OverlayLayer[] = [{
  id: "breaking-lower-third",
  name: "Breaking news banner",
  canvasWidth: 1920,
  canvasHeight: 1080,
  timing: { startSec: 1, durationSec: 12, fadeInMs: 400, fadeOutMs: 400 }
}];

export const NEWS_TEMPLATE = {
  name: "Breaking News Lower Third",
  channelType: "news",
  description: "Category tag, headline/byline banner, and a ticker strip along the bottom edge.",
  html: NEWS_BREAKING_LOWER_THIRD_HTML,
  bindings: NEWS_BINDINGS,
  layers: NEWS_LAYERS
};
