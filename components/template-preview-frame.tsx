"use client";

import { fillTemplate } from "@/lib/overlay/bindings";
import { useEffect, useRef, useState } from "react";

export function TemplatePreviewFrame({ htmlTemplate, values, layersJson, title = "Overlay preview" }: { htmlTemplate: string; values: Record<string, string>; layersJson?: string; title?: string }) {
  const srcDoc = fillTemplate(htmlTemplate, values);
  let canvasWidth = 1920;
  let canvasHeight = 1080;
  try {
    const layer = JSON.parse(layersJson ?? "[]")?.[0];
    if (Number.isFinite(layer?.canvasWidth) && layer.canvasWidth > 0 && Number.isFinite(layer?.canvasHeight) && layer.canvasHeight > 0) {
      canvasWidth = layer.canvasWidth;
      canvasHeight = layer.canvasHeight;
    }
  } catch { /* Keep the preview usable while layer JSON is being edited. */ }
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={containerRef} className="preview-frame-wrap" style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}>
      <iframe title={title} srcDoc={srcDoc} sandbox="" style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${width / canvasWidth})`, transformOrigin: "top left" }} />
    </div>
  );
}
