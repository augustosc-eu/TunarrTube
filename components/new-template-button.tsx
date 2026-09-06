"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { layoutToBindings, renderLayoutToHtml } from "@/lib/overlay/visual";
import type { VisualLayout } from "@/lib/overlay/visual-types";

// A starter layout with one example element, so a brand-new template drops straight into the
// visual builder with something on the canvas rather than a blank rectangle.
const STARTER_LAYOUT: VisualLayout = {
  canvasWidth: 1920,
  canvasHeight: 1080,
  elements: [{
    id: "starter",
    bindingKey: "text1",
    label: "Text",
    sampleValue: "Sample Text",
    x: 64, y: 860, width: 640, height: 90,
    fontSize: 34, fontWeight: 700, color: "#ffffff",
    align: "left", background: "rgba(10, 12, 18, 0.72)",
    padding: 16, borderRadius: 10
  }]
};

export function NewTemplateButton() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New Template",
          channelType: "custom",
          htmlTemplate: renderLayoutToHtml(STARTER_LAYOUT),
          bindingsJson: JSON.stringify(layoutToBindings(STARTER_LAYOUT)),
          layersJson: JSON.stringify([{ id: "layer-1", name: "Layer", canvasWidth: STARTER_LAYOUT.canvasWidth, canvasHeight: STARTER_LAYOUT.canvasHeight, timing: { startSec: 1, durationSec: 10, fadeInMs: 400, fadeOutMs: 400 } }]),
          visualLayoutJson: JSON.stringify(STARTER_LAYOUT)
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not create the template.");
      router.push(`/templates/${body.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  return (
    <div>
      <button type="button" className="button" onClick={create} disabled={creating}>
        <Plus size={15} /> {creating ? "Creating…" : "New template"}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
