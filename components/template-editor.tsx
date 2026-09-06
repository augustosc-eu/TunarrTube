"use client";

import { useMemo, useState } from "react";
import { fillTemplate } from "@/lib/overlay/bindings";
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
  const initialLayout = useMemo(() => parseVisualLayout(template.visualLayoutJson), [template.visualLayoutJson]);
  const [mode, setMode] = useState<"visual" | "code">(initialLayout ? "visual" : "code");
  const [layout, setLayout] = useState<VisualLayout | null>(initialLayout);
  const [html, setHtml] = useState(template.htmlTemplate);
  const [bindingsJson, setBindingsJson] = useState(template.bindingsJson);
  const [layersJson, setLayersJson] = useState(template.layersJson);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const bindings = useMemo<BindingField[] | null>(() => {
    try { return JSON.parse(bindingsJson); } catch { return null; }
  }, [bindingsJson]);

  const sampleValues = useMemo(() => Object.fromEntries((bindings ?? []).map((field) => [field.key, field.sampleValue])), [bindings]);

  const layers = useMemo<OverlayLayer[] | null>(() => {
    try { return JSON.parse(layersJson); } catch { return null; }
  }, [layersJson]);

  // Every visual edit regenerates htmlTemplate/bindingsJson wholesale from the layout -- the
  // layout (not the generated HTML) is the source of truth while one is present.
  function updateLayout(nextLayout: VisualLayout) {
    setLayout(nextLayout);
    setHtml(renderLayoutToHtml(nextLayout));
    setBindingsJson(JSON.stringify(layoutToBindings(nextLayout)));
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

  return (
    <div className="card form-card" style={{ maxWidth: 1100 }}>
      <div className="preview-frame-wrap" style={{ marginBottom: 22 }}>
        <iframe title="Template preview" srcDoc={fillTemplate(html, sampleValues)} sandbox="" />
      </div>

      <div className="toolbar" style={{ marginBottom: 14 }}>
        <button type="button" className={`button${mode === "visual" ? "" : " secondary"}`} disabled={!layout} onClick={() => setMode("visual")}>Visual</button>
        <button type="button" className={`button${mode === "code" ? "" : " secondary"}`} onClick={() => setMode("code")}>Code</button>
        {!layout ? <span className="muted" style={{ marginLeft: 10 }}>Hand-edited past what the visual builder can represent — start a new template to use it.</span> : null}
      </div>

      {mode === "visual" && layout ? (
        <TemplateVisualEditor layout={layout} onChange={updateLayout} />
      ) : (
        <div className="field">
          <label>HTML / CSS ({"{{binding}}"} placeholders)</label>
          {layout ? <p className="muted" style={{ marginBottom: 6 }}>Editing this directly will detach the template from its visual layout on save.</p> : null}
          <textarea className="input" style={{ minHeight: 260, fontFamily: "var(--font-mono)", fontSize: 12 }} value={html} onChange={(event) => editHtmlDirectly(event.target.value)} />
        </div>
      )}

      <div className="form-grid" style={{ marginTop: 18 }}>
        <div className="field">
          <label>Bindings (JSON){layout ? " — derived from the visual layout" : ""}</label>
          <textarea className="input" style={{ minHeight: 140, fontFamily: "var(--font-mono)", fontSize: 12 }} value={bindingsJson} readOnly={Boolean(layout)} onChange={(event) => setBindingsJson(event.target.value)} />
        </div>
        <div className="field">
          <label>Layers (JSON — position/timing)</label>
          <textarea className="input" style={{ minHeight: 140, fontFamily: "var(--font-mono)", fontSize: 12 }} value={layersJson} onChange={(event) => setLayersJson(event.target.value)} />
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {saved ? <p className="success">Saved. New renders will use the updated design; existing renders are unaffected until re-rendered.</p> : null}
      <button className="button" type="button" onClick={save} disabled={saving} style={{ marginTop: 14 }}>{saving ? "Saving…" : "Save template"}</button>
    </div>
  );
}
