"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { TemplateCard } from "@/components/template-card";
import { ViewToggle } from "@/components/view-toggle";
import { BulkBar } from "@/components/bulk-bar";
import { useViewMode } from "@/lib/hooks/use-view-mode";

type Template = { id: string; name: string; channelType: string; isBuiltIn: boolean; description: string | null };

export function TemplateList({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [mode, setMode] = useViewMode("templates");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deletable = templates.filter((template) => !template.isBuiltIn);

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function bulkDelete() {
    if (!window.confirm(`Delete ${selected.size} template${selected.size === 1 ? "" : "s"}? This can't be undone.`)) return;
    setBusy(true); setError(null);
    try {
      const results = await Promise.allSettled([...selected].map(async (id) => {
        const response = await fetch(`/api/templates/${id}`, { method: "DELETE" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "Delete failed");
      }));
      const failures = results.filter((result) => result.status === "rejected");
      setSelected(new Set());
      if (failures.length) setError(`${failures.length} template${failures.length === 1 ? "" : "s"} could not be deleted.`);
      router.refresh();
    } finally { setBusy(false); }
  }

  if (!templates.length) return null;

  return <>
    <div className="toolbar">
      <span className="spacer" />
      <ViewToggle mode={mode} onChange={setMode} />
    </div>
    <BulkBar selected={selected.size} eligible={deletable.length} total={templates.length} busy={busy}
      onSelectAll={() => setSelected(new Set(deletable.map((template) => template.id)))} onClear={() => setSelected(new Set())}>
      <button className="button secondary" disabled={busy} onClick={bulkDelete}><Trash2 size={14} /> Delete ({selected.size})</button>
    </BulkBar>
    {error ? <div className="error">{error}</div> : null}
    <div className={mode}>
      {templates.map((template) => <div className="card-wrap" key={template.id}>
        {template.isBuiltIn ? null : <input type="checkbox" className="card-select" checked={selected.has(template.id)} onChange={() => toggle(template.id)} aria-label={`Select ${template.name}`} />}
        <TemplateCard {...template} />
      </div>)}
    </div>
  </>;
}
