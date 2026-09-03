"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Save } from "lucide-react";

export function SourceSettings({ sourceId, initialMode, initialSyncEnabled, initialInterval }: { sourceId: string; initialMode: string; initialSyncEnabled: boolean; initialInterval: number }) {
  const router = useRouter(); const [mode, setMode] = useState(initialMode); const [enabled, setEnabled] = useState(initialSyncEnabled); const [interval, setIntervalValue] = useState(String(initialInterval)); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);
  async function save() {
    setBusy(true); setMessage(null);
    try { const response = await fetch(`/api/sources/${sourceId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playbackMode: mode, syncEnabled: enabled, syncIntervalMinutes: Number(interval) }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Save failed"); setMessage("Source settings saved."); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); } finally { setBusy(false); }
  }
  return <section className="card integration-card"><h2>Playback and synchronization</h2><div className="form-grid"><div className="field"><label htmlFor="source-mode">Playback mode</label><select id="source-mode" className="input" value={mode} onChange={(event) => setMode(event.target.value)}><option value="download">Permanent</option><option value="cache">Cache on first play</option><option value="stream">Stream on demand</option></select></div><label className="choice"><span><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Automatic sync</span></label><div className="field"><label htmlFor="sync-interval">Interval</label><select id="sync-interval" className="input" value={interval} disabled={!enabled} onChange={(event) => setIntervalValue(event.target.value)}><option value="60">Hourly</option><option value="360">6 hours</option><option value="720">12 hours</option><option value="1440">Daily</option><option value="10080">Weekly</option></select></div></div><button className="button secondary" disabled={busy} onClick={save}>{busy ? <LoaderCircle size={14} className="animate-spin"/> : <Save size={14}/>} Save</button>{message ? <p className={message.includes("saved") ? "success" : "error"}>{message}</p> : null}</section>;
}
