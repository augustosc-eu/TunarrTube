"use client";

import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { VisualElement, VisualLayout } from "@/lib/overlay/visual-types";

const PREVIEW_WIDTH = 640;

function makeElement(index: number): VisualElement {
  const key = `field${index}`;
  return {
    id: `el-${Date.now().toString(36)}-${index}`,
    bindingKey: key,
    label: `Field ${index}`,
    sampleValue: `Sample ${index}`,
    x: 60, y: 60 + (index % 4) * 90,
    width: 480, height: 70,
    fontSize: 28, fontWeight: 700, color: "#ffffff",
    align: "left", background: "rgba(10, 12, 18, 0.72)",
    padding: 12, borderRadius: 8
  };
}

// Drag-to-move / drag-to-resize implemented with plain pointer events (no new dependency,
// matching this codebase's zero-extra-deps convention). `onChange` is called with the whole
// layout on every change; the parent (components/template-editor.tsx) owns persistence and
// regenerates htmlTemplate/bindingsJson from it via lib/overlay/visual.ts.
export function TemplateVisualEditor({ layout, onChange }: { layout: VisualLayout; onChange: (layout: VisualLayout) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scale = PREVIEW_WIDTH / layout.canvasWidth;
  const previewHeight = Math.round(layout.canvasHeight * scale);
  const selected = layout.elements.find((element) => element.id === selectedId) ?? null;

  function updateElement(id: string, patch: Partial<VisualElement>) {
    onChange({ ...layout, elements: layout.elements.map((element) => (element.id === id ? { ...element, ...patch } : element)) });
  }

  function addElement() {
    const element = makeElement(layout.elements.length + 1);
    onChange({ ...layout, elements: [...layout.elements, element] });
    setSelectedId(element.id);
  }

  function removeSelected() {
    if (!selected) return;
    onChange({ ...layout, elements: layout.elements.filter((element) => element.id !== selected.id) });
    setSelectedId(null);
  }

  function dragElement(event: ReactPointerEvent, element: VisualElement, mode: "move" | "resize") {
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(element.id);
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: element.x, y: element.y, width: element.width, height: element.height };

    function onMove(moveEvent: PointerEvent) {
      const dx = (moveEvent.clientX - startX) / scale;
      const dy = (moveEvent.clientY - startY) / scale;
      if (mode === "move") {
        updateElement(element.id, { x: Math.max(0, Math.round(origin.x + dx)), y: Math.max(0, Math.round(origin.y + dy)) });
      } else {
        updateElement(element.id, { width: Math.max(20, Math.round(origin.width + dx)), height: Math.max(20, Math.round(origin.height + dy)) });
      }
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div>
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <button type="button" className="button secondary" onClick={addElement}>+ Add text element</button>
        </div>
        <div
          onPointerDown={() => setSelectedId(null)}
          style={{
            position: "relative", width: PREVIEW_WIDTH, height: previewHeight,
            backgroundImage: "linear-gradient(45deg, #2a2e37 25%, transparent 25%), linear-gradient(-45deg, #2a2e37 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2e37 75%), linear-gradient(-45deg, transparent 75%, #2a2e37 75%)",
            backgroundSize: "20px 20px", backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
            backgroundColor: "#14161b", overflow: "hidden", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)"
          }}
        >
          {layout.elements.map((element) => (
            <div
              key={element.id}
              onPointerDown={(event) => dragElement(event, element, "move")}
              style={{
                position: "absolute",
                left: element.x * scale, top: element.y * scale, width: element.width * scale, height: element.height * scale,
                fontSize: Math.max(8, element.fontSize * scale), fontWeight: element.fontWeight, color: element.color,
                textAlign: element.align, padding: element.padding * scale, borderRadius: element.borderRadius * scale,
                background: element.background, boxSizing: "border-box", overflow: "hidden", cursor: "move",
                outline: element.id === selectedId ? "2px solid #7c3aed" : "1px dashed rgba(255,255,255,0.4)",
                fontFamily: "'Helvetica Neue', Arial, sans-serif", userSelect: "none"
              }}
            >
              {element.sampleValue || element.bindingKey}
              <div
                onPointerDown={(event) => dragElement(event, element, "resize")}
                title="Drag to resize"
                style={{ position: "absolute", right: -5, bottom: -5, width: 12, height: 12, background: "#7c3aed", borderRadius: 3, cursor: "nwse-resize" }}
              />
            </div>
          ))}
        </div>
      </div>

      <div style={{ minWidth: 240, flex: "1 0 240px" }}>
        {selected ? (
          <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
            <div className="field">
              <label>Binding key</label>
              <input className="input" value={selected.bindingKey} onChange={(event) => updateElement(selected.id, { bindingKey: event.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} />
            </div>
            <div className="field">
              <label>Label (shown when editing a media item)</label>
              <input className="input" value={selected.label ?? ""} onChange={(event) => updateElement(selected.id, { label: event.target.value })} />
            </div>
            <div className="field">
              <label>Sample text (used in previews)</label>
              <input className="input" value={selected.sampleValue ?? ""} onChange={(event) => updateElement(selected.id, { sampleValue: event.target.value })} />
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Font size</label>
                <input type="number" className="input" value={selected.fontSize} onChange={(event) => updateElement(selected.id, { fontSize: Number(event.target.value) || 1 })} />
              </div>
              <div className="field">
                <label>Weight</label>
                <select className="input" value={selected.fontWeight} onChange={(event) => updateElement(selected.id, { fontWeight: Number(event.target.value) as 400 | 700 })}>
                  <option value={400}>Regular</option>
                  <option value={700}>Bold</option>
                </select>
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Color</label>
                <input type="color" className="input" value={selected.color} onChange={(event) => updateElement(selected.id, { color: event.target.value })} />
              </div>
              <div className="field">
                <label>Align</label>
                <select className="input" value={selected.align} onChange={(event) => updateElement(selected.id, { align: event.target.value as VisualElement["align"] })}>
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Background (any CSS color, or blank for none)</label>
              <input className="input" value={selected.background ?? ""} placeholder="rgba(10,12,18,0.72)" onChange={(event) => updateElement(selected.id, { background: event.target.value || undefined })} />
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Padding</label>
                <input type="number" className="input" value={selected.padding} onChange={(event) => updateElement(selected.id, { padding: Number(event.target.value) || 0 })} />
              </div>
              <div className="field">
                <label>Corner radius</label>
                <input type="number" className="input" value={selected.borderRadius} onChange={(event) => updateElement(selected.id, { borderRadius: Number(event.target.value) || 0 })} />
              </div>
            </div>
            <button type="button" className="button secondary" onClick={removeSelected}>Delete element</button>
          </div>
        ) : (
          <p className="muted">Click an element to edit it, drag it to reposition, or drag the purple handle to resize.</p>
        )}

        <div className="form-grid" style={{ marginTop: 18 }}>
          <div className="field">
            <label>Canvas width</label>
            <input type="number" className="input" value={layout.canvasWidth} onChange={(event) => onChange({ ...layout, canvasWidth: Number(event.target.value) || 1 })} />
          </div>
          <div className="field">
            <label>Canvas height</label>
            <input type="number" className="input" value={layout.canvasHeight} onChange={(event) => onChange({ ...layout, canvasHeight: Number(event.target.value) || 1 })} />
          </div>
        </div>
      </div>
    </div>
  );
}
