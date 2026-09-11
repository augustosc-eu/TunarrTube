"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TemplatePreviewFrame } from "@/components/template-preview-frame";
import { layoutToBindings, renderLayoutToHtml } from "@/lib/overlay/visual";
import { TemplateVisualEditor } from "@/components/template-visual-editor";
import type { BindingField, OverlayLayer } from "@/lib/overlay/types";
import type { VisualLayout } from "@/lib/overlay/visual-types";

type Template = { id: string; name: string; description: string | null; htmlTemplate: string; bindingsJson: string; layersJson: string; isBuiltIn: boolean; visualLayoutJson: string | null };

function parseVisualLayout(json: string | null): VisualLayout | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && Array.isArray((parsed as VisualLayout).elements) ? (parsed as VisualLayout) : null;
  } catch {
    return null;
  }
}

export function TemplateEditor({ template }: { template: Template }) {
  const router = useRouter();
  const initialLayout = useMemo(() => parseVisualLayout(template.visualLayoutJson), [template.visualLayoutJson]);
  const [mode, setMode] = useState<"visual" | "code">(initialLayout ? "visual" : "code");
  const [layout, setLayout] = useState<VisualLayout | null>(initialLayout);
  const [html, setHtml] = useState(template.htmlTemplate);
  const [bindingsJson, setBindingsJson] = useState(template.bindingsJson);
  const [layersJson, setLayersJson] = useState(template.layersJson);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const bindings = useMemo<BindingField[] | null>(() => {
    try { return JSON.parse(bindingsJson); } catch { return null; }
  }, [bindingsJson]);

  const sampleValues = useMemo(() => Object.fromEntries((bindings ?? []).map((field) => [field.key, field.sampleValue])), [bindings]);

  const layers = useMemo<OverlayLayer[] | null>(() => {
    try { return JSON.parse(layersJson); } catch { return null; }
  }, [layersJson]);

  // Every visual edit regenerates htmlTemplate/bindingsJson wholesale from the layout -- the
  // layout (not the generated HTML) is the source of truth while one is present. Each layer's own
  // canvasWidth/canvasHeight (lib/overlay/service.ts:renderOverlayLayers -- the actual viewport the
  // renderer screenshots htmlTemplate at) has to track the layout's canvas size the same way:
  // elements are positioned in absolute pixels against layout.canvasWidth/canvasHeight, so a layer
  // rendered at any other size renders those same positions into the wrong-size viewport, cropping
  // or misplacing everything relative to what the visual preview showed.
  function updateLayout(nextLayout: VisualLayout) {
    setLayout(nextLayout);
    setHtml(renderLayoutToHtml(nextLayout));
    setBindingsJson(JSON.stringify(layoutToBindings(nextLayout)));
    setLayersJson((current) => {
      try {
        const parsed = JSON.parse(current) as unknown;
        if (!Array.isArray(parsed)) return current;
        const synced = (parsed as OverlayLayer[]).map((layer) => ({ ...layer, canvasWidth: nextLayout.canvasWidth, canvasHeight: nextLayout.canvasHeight }));
        return JSON.stringify(synced);
      } catch {
        return current;
      }
    });
  }

  // Editing raw HTML by hand can't be reconciled back into element positions, so it detaches the
  // template from its visual layout -- the next save drops visualLayoutJson to null.
  function editHtmlDirectly(value: string) {
    setHtml(value);
    if (layout) setLayout(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      if (!bindings) throw new Error("Bindings JSON is not valid.");
      if (!layers) throw new Error("Layers JSON is not valid.");
      const response = await fetch(`/api/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ htmlTemplate: html, bindingsJson, layersJson, visualLayoutJson: layout ? JSON.stringify(layout) : null })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not save the template.");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${template.name}"? This can't be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/templates/${template.id}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not delete the template.");
      router.push("/templates");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  return (
    <div className="card form-card" style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 22 }}>
        <TemplatePreviewFrame title="Template preview" htmlTemplate={html} values={sampleValues} layersJson={layersJson} />
      </div>

      <div className="toolbar" style={{ marginBottom: 14 }}>
        <button type="button" className={`button${mode === "visual" ? "" : " secondary"}`} aria-pressed={mode === "visual"} disabled={!layout} onClick={() => setMode("visual")}>Visual</button>
        <button type="button" className={`button${mode === "code" ? "" : " secondary"}`} aria-pressed={mode === "code"} onClick={() => setMode("code")}>Code</button>
        {!layout ? <span className="muted" style={{ marginLeft: 10 }}>Hand-edited past what the visual builder can represent — start a new template to use it.</span> : null}
      </div>

      {mode === "visual" && layout ? (
        <TemplateVisualEditor layout={layout} onChange={updateLayout} />
      ) : (
        <div className="field">
          <label htmlFor="template-html">HTML / CSS ({"{{binding}}"} placeholders)</label>
          {layout ? <p className="muted" style={{ marginBottom: 6 }}>Editing this directly will detach the template from its visual layout on save.</p> : null}
          <textarea id="template-html" className="input" style={{ minHeight: 260, fontFamily: "var(--font-mono)", fontSize: 12 }} value={html} onChange={(event) => editHtmlDirectly(event.target.value)} />
        </div>
      )}

      <div className="form-grid" style={{ marginTop: 18 }}>
        <div className="field">
          <label htmlFor="template-bindings">Bindings (JSON){layout ? " — derived from the visual layout" : ""}</label>
          <textarea id="template-bindings" className="input" style={{ minHeight: 140, fontFamily: "var(--font-mono)", fontSize: 12 }} value={bindingsJson} readOnly={Boolean(layout)} onChange={(event) => setBindingsJson(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="template-layers">Layers (JSON — position/timing)</label>
          <textarea id="template-layers" className="input" style={{ minHeight: 140, fontFamily: "var(--font-mono)", fontSize: 12 }} value={layersJson} onChange={(event) => setLayersJson(event.target.value)} />
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {saved ? <p className="success">Saved. New renders will use the updated design; existing renders are unaffected until re-rendered.</p> : null}
      <div className="toolbar" style={{ marginTop: 14 }}>
        <button className="button" type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save template"}</button>
        {!template.isBuiltIn ? (
          <button className="button secondary" type="button" onClick={remove} disabled={deleting}>{deleting ? "Deleting…" : "Delete template"}</button>
        ) : (
          <span className="muted">Built-in templates can't be deleted.</span>
        )}
      </div>
    </div>
  );
}
