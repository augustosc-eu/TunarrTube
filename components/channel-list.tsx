"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Clapperboard, Trash2 } from "lucide-react";
import { ChannelCard } from "@/components/channel-card";
import { ViewToggle } from "@/components/view-toggle";
import { BulkBar } from "@/components/bulk-bar";
import { useViewMode } from "@/lib/hooks/use-view-mode";

type Channel = { id: string; name: string; channelType: string; itemCount: number; published: boolean };

export function ChannelList({ channels }: { channels: Channel[] }) {
  const router = useRouter();
  const [mode, setMode] = useViewMode("channels");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function bulkDelete() {
    if (!window.confirm(`Delete ${selected.size} channel${selected.size === 1 ? "" : "s"}? This can't be undone.`)) return;
    setBusy(true); setError(null);
    try {
      const results = await Promise.allSettled([...selected].map(async (id) => {
        const response = await fetch(`/api/channels/${id}`, { method: "DELETE" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "Delete failed");
      }));
      const failures = results.filter((result) => result.status === "rejected");
      setSelected(new Set());
      if (failures.length) setError(`${failures.length} channel${failures.length === 1 ? "" : "s"} could not be deleted.`);
      router.refresh();
    } finally { setBusy(false); }
  }

  if (!channels.length) {
    return <div className="empty">
      <Clapperboard size={32} />
      <h2>No channels yet</h2>
      <p>Create a channel, add local files, an existing downloaded video, or a YouTube URL, attach metadata, and burn in the overlay before publishing to Tunarr.</p>
      <Link className="button" href="/channels/new">Create your first channel</Link>
    </div>;
  }

  return <>
    <div className="toolbar">
      <span className="spacer" />
      <ViewToggle mode={mode} onChange={setMode} />
    </div>
    <BulkBar selected={selected.size} eligible={channels.length} total={channels.length} busy={busy}
      onSelectAll={() => setSelected(new Set(channels.map((channel) => channel.id)))} onClear={() => setSelected(new Set())}>
      <button className="button secondary" disabled={busy} onClick={bulkDelete}><Trash2 size={14} /> Delete ({selected.size})</button>
    </BulkBar>
    {error ? <div className="error">{error}</div> : null}
    <div className={mode}>
      {channels.map((channel) => <div className="card-wrap" key={channel.id}>
        <input type="checkbox" className="card-select" checked={selected.has(channel.id)} onChange={() => toggle(channel.id)} aria-label={`Select ${channel.name}`} />
        <ChannelCard {...channel} />
      </div>)}
    </div>
  </>;
}
