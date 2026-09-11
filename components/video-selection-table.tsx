"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, LoaderCircle, Play, Trash2, X } from "lucide-react";

type Row = { membershipId: string; videoId: string; youtubeId: string; title: string; uploader: string | null; durationSeconds: number | null; playlistIndex: number | null; metadataStatus: string; availability: string; availabilityReason: string | null; membershipStatus: string; downloadStatus: string };

function duration(seconds: number | null) {
  if (seconds == null) return "—";
  const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60;
  return `${hours ? `${hours}:` : ""}${hours ? String(minutes).padStart(2, "0") : minutes}:${String(remainder).padStart(2, "0")}`;
}

type SortKey = "index" | "title" | "duration" | "status";
// Order matches the actual <td> column order below (# / Video / Duration / ... / Download).
const SORT_COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "index", label: "#" }, { key: "title", label: "Video" }, { key: "duration", label: "Duration" }
];
const STATUS_SORT_COLUMN: { key: SortKey; label: string } = { key: "status", label: "Download" };

function sortValue(row: Row, key: SortKey): string | number {
  switch (key) {
    case "index": return row.playlistIndex ?? Number.MAX_SAFE_INTEGER;
    case "title": return row.title.toLowerCase();
    case "duration": return row.durationSeconds ?? -1;
    case "status": return row.downloadStatus;
  }
}

// A Source can hold hundreds of videos with no built-in pagination -- client-side search/sort (rather
// than a server round-trip) keeps this responsive since `rows` is already the full, already-fetched
// list, and lets filtering/sorting react instantly as the operator types instead of waiting on a
// request each keystroke.
export function VideoSelectionTable({ sourceId, rows }: { sourceId: string; rows: Row[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Row | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [bulkRemoving, setBulkRemoving] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? rows.filter((row) => row.title.toLowerCase().includes(query) || row.uploader?.toLowerCase().includes(query)) : rows;
  }, [rows, search]);
  const visible = useMemo(() => {
    if (!sort) return filtered;
    const direction = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = sortValue(a, sort.key); const right = sortValue(b, sort.key);
      return left < right ? -direction : left > right ? direction : 0;
    });
  }, [filtered, sort]);

  function toggleSort(key: SortKey) {
    setSort((current) => current?.key === key ? (current.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" });
  }
  function sortHeader(column: { key: SortKey; label: string }) {
    return <th key={column.key}>
      <button type="button" className="sort-header" onClick={() => toggleSort(column.key)} aria-label={`Sort by ${column.label}`}>
        {column.label} {sort?.key === column.key ? (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="muted" />}
      </button>
    </th>;
  }

  // "Select all" scopes to what's currently visible (filtered/sorted), not the full source -- searching
  // for "live" and selecting all should only select the matching rows, not everything.
  const downloadable = rows.filter((row) => row.downloadStatus !== "complete" && row.membershipStatus === "present");
  const visibleDownloadable = visible.filter((row) => row.downloadStatus !== "complete" && row.membershipStatus === "present");
  const removableSelected = rows.filter((row) => selected.has(row.videoId) && (row.downloadStatus === "unavailable" || row.downloadStatus === "failed"));
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

  // Offered for a video downloadVideo() gave up on (lib/downloads/service.ts) -- "unavailable" won't be
  // retried automatically, and "failed" has exhausted its automatic retries too, so removing it here is
  // the other half of "retry or remove": Retry lives on the Jobs page for the underlying job.
  async function remove(row: Row) {
    if (!confirm(`Remove "${row.title}" from this source? This can't be undone.`)) return;
    setRemoving(row.videoId); setError(null);
    try {
      const response = await fetch(`/api/sources/${sourceId}/videos/${row.videoId}`, { method: "DELETE" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Removal failed");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Removal failed"); }
    finally { setRemoving(null); }
  }

  async function bulkRemove() {
    if (!removableSelected.length) return;
    if (!window.confirm(`Remove ${removableSelected.length} video${removableSelected.length === 1 ? "" : "s"} from this source? This can't be undone.`)) return;
    setBulkRemoving(true); setError(null);
    try {
      const results = await Promise.allSettled(removableSelected.map((row) => fetch(`/api/sources/${sourceId}/videos/${row.videoId}`, { method: "DELETE" })));
      const failures = results.filter((result) => result.status === "rejected");
      setSelected(new Set());
      if (failures.length) setError(`${failures.length} video${failures.length === 1 ? "" : "s"} could not be removed.`);
      router.refresh();
    } finally { setBulkRemoving(false); }
  }

  return <>
    {playing ? <div className="card player"><div className="toolbar"><strong>{playing.title}</strong><span className="spacer"/><button className="button secondary" onClick={() => setPlaying(null)} aria-label="Close player"><X size={15}/></button></div><video controls autoPlay src={`/api/playback/${sourceId}/${playing.videoId}`} /></div> : null}
    <div className="toolbar">
      <button className="button" disabled={busy || selected.size === 0} onClick={download}><Download size={15} /> Download selected ({selected.size})</button>
      {removableSelected.length > 0 ? <button className="button secondary" disabled={bulkRemoving} onClick={bulkRemove}><Trash2 size={15} /> Remove selected ({removableSelected.length})</button> : null}
      <input className="input" type="search" placeholder="Search by title or uploader…" value={search} onChange={(event) => setSearch(event.target.value)} style={{ maxWidth: 260 }} aria-label="Search videos" />
      <span className="muted">{search ? `${visible.length} of ${rows.length} videos` : `${rows.length} video${rows.length === 1 ? "" : "s"}`} · {downloadable.length} available to download</span>
    </div>
    {error ? <div className="error">{error}</div> : null}
    <div className="table-wrap responsive-table"><table><thead><tr>
      <th><input type="checkbox" aria-label="Select all visible downloadable videos" checked={visibleDownloadable.length > 0 && visibleDownloadable.every((row) => selected.has(row.videoId))} onChange={(event) => setSelected((current) => {
        const next = new Set(current);
        for (const row of visibleDownloadable) event.target.checked ? next.add(row.videoId) : next.delete(row.videoId);
        return next;
      })} /></th>
      {SORT_COLUMNS.map((column) => sortHeader(column))}
      <th>Metadata</th>
      {sortHeader(STATUS_SORT_COLUMN)}
      <th>Play</th><th></th>
    </tr></thead><tbody>{visible.map((row) => <tr key={row.membershipId}>
      <td data-label="Select"><input type="checkbox" disabled={row.downloadStatus === "complete" || (row.membershipStatus !== "present" && row.downloadStatus !== "unavailable" && row.downloadStatus !== "failed")} checked={selected.has(row.videoId)} onChange={() => toggle(row.videoId)} aria-label={`Select ${row.title}`} /></td>
      <td data-label="#">{row.playlistIndex ?? "—"}</td>
      <td className="title-cell" data-label="Video"><strong>{row.title}</strong><span className="meta">{row.uploader ?? row.youtubeId}{row.membershipStatus === "missing" ? " · Missing from source" : ""}</span></td>
      <td data-label="Duration">{duration(row.durationSeconds)}</td>
      <td data-label="Metadata"><span className={`badge ${row.availability === "unavailable" ? "unavailable" : row.metadataStatus}`}>{row.availability === "unavailable" ? "unavailable" : row.metadataStatus}</span>{row.availabilityReason ? <span className="availability-reason">{row.availabilityReason}</span> : null}</td>
      <td data-label="Download"><span className={`badge ${row.downloadStatus}`}>{row.downloadStatus.replaceAll("_", " ")}</span></td>
      <td data-label="Play"><button className="button secondary" aria-label={`Play ${row.title}`} disabled={preparing === row.videoId || row.membershipStatus !== "present"} onClick={() => play(row)}>{preparing === row.videoId ? <LoaderCircle size={14} className="animate-spin"/> : <Play size={14}/>}</button></td>
      <td data-label="Remove">{row.downloadStatus === "unavailable" || row.downloadStatus === "failed"
        ? <button className="button secondary" aria-label={`Remove ${row.title}`} disabled={removing === row.videoId} onClick={() => remove(row)}>{removing === row.videoId ? <LoaderCircle size={14} className="animate-spin"/> : <Trash2 size={14}/>}</button>
        : null}</td>
    </tr>)}</tbody></table></div>
  </>;
}
