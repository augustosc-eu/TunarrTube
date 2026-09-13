"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ListVideo, RefreshCw, Trash2 } from "lucide-react";
import { SourceCard } from "@/components/source-card";
import { ViewToggle } from "@/components/view-toggle";
import { BulkBar } from "@/components/bulk-bar";
import { useViewMode } from "@/lib/hooks/use-view-mode";

type Source = { id: string; name: string; uploaderName: string | null; thumbnailUrl: string | null; thumbnailPath: string | null; sourceType: string; playbackMode: string; count: number; lastSyncedAt: Date | null };

async function message(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body.data;
}

export function SourceList({ sources }: { sources: Source[] }) {
  const router = useRouter();
  const [mode, setMode] = useViewMode("sources");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function bulkDelete() {
    if (!window.confirm(`Remove ${selected.size} source${selected.size === 1 ? "" : "s"}? Downloaded media will be preserved.`)) return;
    setBusy(true); setError(null);
    try {
      const results = await Promise.allSettled([...selected].map(async (id) => message(await fetch(`/api/sources/${id}`, { method: "DELETE" }))));
      const failures = results.filter((result) => result.status === "rejected");
      setSelected(new Set());
      if (failures.length) setError(`${failures.length} source${failures.length === 1 ? "" : "s"} could not be removed.`);
      router.refresh();
    } finally { setBusy(false); }
  }

  async function bulkSync() {
    const syncable = sources.filter((source) => selected.has(source.id) && source.sourceType !== "collection");
    setBusy(true); setError(null);
    try {
      const results = await Promise.allSettled(syncable.map(async (source) => message(await fetch(`/api/sources/${source.id}/sync`, { method: "POST" }))));
      const failures = results.filter((result) => result.status === "rejected");
      setSelected(new Set());
      if (failures.length) setError(`${failures.length} sync${failures.length === 1 ? "" : "s"} could not be queued.`);
      router.refresh();
    } finally { setBusy(false); }
  }

  if (!sources.length) return <div className="empty"><ListVideo size={32} /><h2>No sources configured</h2><p>Add an individual video, playlist, or channel to begin.</p></div>;

  const syncableSelectedCount = sources.filter((source) => selected.has(source.id) && source.sourceType !== "collection").length;

  return <>
    <div className="toolbar">
      <span className="spacer" />
      <ViewToggle mode={mode} onChange={setMode} />
    </div>
    <BulkBar selected={selected.size} eligible={sources.length} total={sources.length} busy={busy}
      onSelectAll={() => setSelected(new Set(sources.map((source) => source.id)))} onClear={() => setSelected(new Set())}>
      {syncableSelectedCount > 0 ? <button className="button secondary" disabled={busy} onClick={bulkSync}><RefreshCw size={14} /> Sync ({syncableSelectedCount})</button> : null}
      <button className="button secondary" disabled={busy} onClick={bulkDelete}><Trash2 size={14} /> Delete ({selected.size})</button>
    </BulkBar>
    {error ? <div className="error">{error}</div> : null}
    <div className={mode}>
      {sources.map((source) => <div className="card-wrap" key={source.id}>
        <input type="checkbox" className="card-select" checked={selected.has(source.id)} onChange={() => toggle(source.id)} aria-label={`Select ${source.name}`} />
        <SourceCard {...source} count={source.count} />
      </div>)}
    </div>
  </>;
}
