"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, LoaderCircle, Play, X } from "lucide-react";

type Row = { membershipId: string; videoId: string; youtubeId: string; title: string; uploader: string | null; durationSeconds: number | null; playlistIndex: number | null; metadataStatus: string; availability: string; availabilityReason: string | null; membershipStatus: string; downloadStatus: string };

function duration(seconds: number | null) {
  if (seconds == null) return "—";
  const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60;
  return `${hours ? `${hours}:` : ""}${hours ? String(minutes).padStart(2, "0") : minutes}:${String(remainder).padStart(2, "0")}`;
}

export function VideoSelectionTable({ sourceId, rows }: { sourceId: string; rows: Row[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Row | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const downloadable = rows.filter((row) => row.downloadStatus !== "complete" && row.membershipStatus === "present");
  function toggle(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }

  async function download() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/downloads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [...selected].map((videoId) => ({ sourceId, videoId })) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Queueing failed");
      setSelected(new Set()); router.refresh();
      const ids = body.data.map((job: { id: string }) => job.id);
      while (ids.length) {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        const states = await Promise.all(ids.map(async (id: string) => (await (await fetch(`/api/jobs/${id}`, { cache: "no-store" })).json()).data));
        if (states.every((job) => ["complete", "failed", "cancelled"].includes(job.status))) {
          const failures = states.filter((job) => job.status === "failed");
          if (failures.length) setError(failures.map((job) => job.error ?? "Download failed").join("\n"));
          break;
        }
        router.refresh();
      }
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Download failed"); }
    finally { setBusy(false); }
  }

  async function play(row: Row) {
    setPreparing(row.videoId); setError(null);
    try {
      const response = await fetch("/api/playback/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, videoId: row.videoId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Playback preparation failed");
      if (body.data.jobId) for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const currentResponse = await fetch(`/api/jobs/${body.data.jobId}`, { cache: "no-store" }); const currentBody = await currentResponse.json();
        if (["complete", "failed", "cancelled"].includes(currentBody.data.status)) { if (currentBody.data.status !== "complete") throw new Error(currentBody.data.error ?? "Playback preparation failed"); break; }
      }
      setPlaying(row);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Playback failed"); } finally { setPreparing(null); }
  }

  return <>
    {playing ? <div className="card player"><div className="toolbar"><strong>{playing.title}</strong><span className="spacer"/><button className="button secondary" onClick={() => setPlaying(null)} aria-label="Close player"><X size={15}/></button></div><video controls autoPlay src={`/api/playback/${sourceId}/${playing.videoId}`} /></div> : null}
    <div className="toolbar"><button className="button" disabled={busy || selected.size === 0} onClick={download}><Download size={15} /> Download selected ({selected.size})</button><span className="muted">{downloadable.length} available to download</span></div>
    {error ? <div className="error">{error}</div> : null}
    <div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select all downloadable videos" checked={downloadable.length > 0 && downloadable.every((row) => selected.has(row.videoId))} onChange={(event) => setSelected(event.target.checked ? new Set(downloadable.map((row) => row.videoId)) : new Set())} /></th><th>#</th><th>Video</th><th>Duration</th><th>Metadata</th><th>Download</th><th>Play</th></tr></thead><tbody>{rows.map((row) => <tr key={row.membershipId}>
      <td><input type="checkbox" disabled={row.downloadStatus === "complete" || row.membershipStatus !== "present"} checked={selected.has(row.videoId)} onChange={() => toggle(row.videoId)} aria-label={`Select ${row.title}`} /></td>
      <td>{row.playlistIndex ?? "—"}</td>
      <td className="title-cell"><strong>{row.title}</strong><span className="meta">{row.uploader ?? row.youtubeId}{row.membershipStatus === "missing" ? " · Missing from source" : ""}</span></td>
      <td>{duration(row.durationSeconds)}</td>
      <td><span className={`badge ${row.availability === "unavailable" ? "unavailable" : row.metadataStatus}`}>{row.availability === "unavailable" ? "unavailable" : row.metadataStatus}</span>{row.availabilityReason ? <span className="availability-reason">{row.availabilityReason}</span> : null}</td>
      <td><span className={`badge ${row.downloadStatus}`}>{row.downloadStatus.replaceAll("_", " ")}</span></td>
      <td><button className="button secondary" disabled={preparing === row.videoId || row.membershipStatus !== "present"} onClick={() => play(row)}>{preparing === row.videoId ? <LoaderCircle size={14} className="animate-spin"/> : <Play size={14}/>}</button></td>
    </tr>)}</tbody></table></div>
  </>;
}
