"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";

async function message(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body.data;
}

export function SourceActions({ sourceId, canSync = true }: { sourceId: string; canSync?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  async function sync() {
    setBusy(true); setStatus(null);
    try {
      const job = await message(await fetch(`/api/sources/${sourceId}/sync`, { method: "POST" }));
      setStatus("Sync queued");
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const current = await message(await fetch(`/api/jobs/${job.id}`, { cache: "no-store" }));
        if (["complete", "failed", "cancelled"].includes(current.status)) { setStatus(current.status === "complete" ? "Sync complete" : current.error ?? "Sync failed"); break; }
      }
      router.refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Sync failed"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm("Remove this source? Downloaded media will be preserved.")) return;
    setBusy(true);
    try { await message(await fetch(`/api/sources/${sourceId}`, { method: "DELETE" })); router.push("/sources"); router.refresh(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Delete failed"); setBusy(false); }
  }
  return <div className="toolbar">{canSync ? <button className="button secondary" disabled={busy} onClick={sync}><RefreshCw size={15} className={busy ? "animate-spin" : ""} /> Sync Now</button> : null}<button className="button secondary" disabled={busy} onClick={remove} aria-label="Delete source"><Trash2 size={15} /></button>{status && <span className={status.includes("complete") ? "success" : "muted"}>{status}</span>}</div>;
}
