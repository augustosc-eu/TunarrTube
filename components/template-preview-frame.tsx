"use client";

import { fillTemplate } from "@/lib/overlay/bindings";

export function TemplatePreviewFrame({ htmlTemplate, values }: { htmlTemplate: string; values: Record<string, string> }) {
  const srcDoc = fillTemplate(htmlTemplate, values);
  return (
    <div className="preview-frame-wrap">
      <iframe title="Overlay preview" srcDoc={srcDoc} sandbox="" />
    </div>
  );
}
