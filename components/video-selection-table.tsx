"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, LoaderCircle, Play, Trash2, X } from "lucide-react";

type Row = { membershipId: string; videoId: string; youtubeId: string; title: string; uploader: string | null; durationSeconds: number | null; playlistIndex: number | null; metadataStatus: string; availability: string; availabilityReason: string | null; membershipStatus: string; downloadStatus: string };

function duration(seconds: number | null) {
  if (seconds == null) return "—";
  const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60;
  return `${hours ? `${hours}:` : ""}${hours ? String(minutes).padStart(2, "0") : minutes}:${String(remainder).padStart(2, "0")}`;
}

type SortKey = "index" | "title" | "duration" | "status";
// Order matches the actual cell order below (# / Video / Duration / ... / Download).
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

// A Source can hold thousands of videos with no built-in pagination (Source.historyLimit allows up to
// 5000, and a plain playlist/channel with no limit set pulls its full history) -- client-side
// search/sort (rather than a server round-trip) keeps filtering/sorting instant since `rows` is already
// the full, already-fetched list. Row *rendering* below is virtualized on top of that (only the rows
// scrolled into view are ever mounted) so a huge list doesn't mean a huge DOM.
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
    return <div className="video-grid-cell" key={column.key} role="columnheader">
      <button type="button" className="sort-header" onClick={() => toggleSort(column.key)} aria-label={`Sort by ${column.label}`}>
        {column.label} {sort?.key === column.key ? (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="muted" />}
      </button>
    </div>;
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

  function row(item: Row) {
    return <>
      <div className="video-grid-cell" data-label="Select"><input type="checkbox" disabled={item.downloadStatus === "complete" || (item.membershipStatus !== "present" && item.downloadStatus !== "unavailable" && item.downloadStatus !== "failed")} checked={selected.has(item.videoId)} onChange={() => toggle(item.videoId)} aria-label={`Select ${item.title}`} /></div>
      <div className="video-grid-cell" data-label="#">{item.playlistIndex ?? "—"}</div>
      <div className="video-grid-cell title-cell" data-label="Video"><strong>{item.title}</strong><span className="meta">{item.uploader ?? item.youtubeId}{item.membershipStatus === "missing" ? " · Missing from source" : ""}</span></div>
      <div className="video-grid-cell" data-label="Duration">{duration(item.durationSeconds)}</div>
      <div className="video-grid-cell" data-label="Metadata"><span className={`badge ${item.availability === "unavailable" ? "unavailable" : item.metadataStatus}`}>{item.availability === "unavailable" ? "unavailable" : item.metadataStatus}</span>{item.availabilityReason ? <span className="availability-reason">{item.availabilityReason}</span> : null}</div>
      <div className="video-grid-cell" data-label="Download"><span className={`badge ${item.downloadStatus}`}>{item.downloadStatus.replaceAll("_", " ")}</span></div>
      <div className="video-grid-cell" data-label="Play"><button className="button secondary" aria-label={`Play ${item.title}`} disabled={preparing === item.videoId || item.membershipStatus !== "present"} onClick={() => play(item)}>{preparing === item.videoId ? <LoaderCircle size={14} className="animate-spin"/> : <Play size={14}/>}</button></div>
      <div className="video-grid-cell" data-label="Remove">{item.downloadStatus === "unavailable" || item.downloadStatus === "failed"
        ? <button className="button secondary" aria-label={`Remove ${item.title}`} disabled={removing === item.videoId} onClick={() => remove(item)}>{removing === item.videoId ? <LoaderCircle size={14} className="animate-spin"/> : <Trash2 size={14}/>}</button>
        : null}</div>
    </>;
  }

  const selectAllHeader = <div className="video-grid-cell" role="columnheader"><input type="checkbox" aria-label="Select all visible downloadable videos" checked={visibleDownloadable.length > 0 && visibleDownloadable.every((item) => selected.has(item.videoId))} onChange={(event) => setSelected((current) => {
    const next = new Set(current);
    for (const item of visibleDownloadable) event.target.checked ? next.add(item.videoId) : next.delete(item.videoId);
    return next;
  })} /></div>;

  return <>
    {playing ? <div className="card player"><div className="toolbar"><strong>{playing.title}</strong><span className="spacer"/><button className="button secondary" onClick={() => setPlaying(null)} aria-label="Close player"><X size={15}/></button></div><video controls autoPlay src={`/api/playback/${sourceId}/${playing.videoId}`} /></div> : null}
    <div className="toolbar">
      <button className="button" disabled={busy || selected.size === 0} onClick={download}><Download size={15} /> Download selected ({selected.size})</button>
      {removableSelected.length > 0 ? <button className="button secondary" disabled={bulkRemoving} onClick={bulkRemove}><Trash2 size={15} /> Remove selected ({removableSelected.length})</button> : null}
      <input className="input" type="search" placeholder="Search by title or uploader…" value={search} onChange={(event) => setSearch(event.target.value)} style={{ maxWidth: 260 }} aria-label="Search videos" />
      <span className="muted">{search ? `${visible.length} of ${rows.length} videos` : `${rows.length} video${rows.length === 1 ? "" : "s"}`} · {downloadable.length} available to download</span>
    </div>
    {error ? <div className="error">{error}</div> : null}
    <VirtualizedRows visible={visible} selectAllHeader={selectAllHeader} sortHeader={sortHeader} row={row} />
  </>;
}

// Split out so the virtualizer (a browser-only concern -- it measures real DOM elements) only ever runs
// once mounted on the client, and so the desktop grid/mobile-card branch below stays readable next to
// the row-rendering logic it wraps.
function VirtualizedRows({ visible, selectAllHeader, sortHeader, row }: {
  visible: Row[];
  selectAllHeader: React.ReactNode;
  sortHeader: (column: { key: SortKey; label: string }) => React.ReactNode;
  row: (item: Row) => React.ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  // Below 640px this same table becomes a stack of label/value cards (see .video-grid-row's mobile
  // rules in app/globals.css) -- variable, often multi-line height per card, on a surface people rarely
  // scrub thousands of rows on. Virtualizing there would need a real scroll container height fight with
  // the page's own scroll, for little benefit, so it's simplest and safest to keep that layout exactly
  // as it always rendered (every row mounted) and only virtualize the dense desktop table.
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 641px)");
    setIsDesktop(query.matches);
    const listener = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 49,
    overscan: 12,
    enabled: isDesktop
  });

  const header = <div className="video-grid-row video-grid-header" role="row">
    {selectAllHeader}
    {SORT_COLUMNS.map((column) => sortHeader(column))}
    <div className="video-grid-cell" role="columnheader">Metadata</div>
    {sortHeader(STATUS_SORT_COLUMN)}
    <div className="video-grid-cell" role="columnheader">Play</div>
    <div className="video-grid-cell" role="columnheader" />
  </div>;

  if (!isDesktop) {
    return <div className="table-wrap responsive-table video-grid" role="table" aria-label="Videos">
      {header}
      <div role="rowgroup">
        {visible.map((item) => <div className="video-grid-row" role="row" key={item.membershipId}>{row(item)}</div>)}
      </div>
    </div>;
  }

  return <div className="table-wrap video-grid" role="table" aria-label="Videos">
    {header}
    <div className="video-grid-body" ref={parentRef} role="rowgroup">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = visible[virtualRow.index];
          return <div
            key={item.membershipId}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            role="row"
            className="video-grid-row"
            style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}
          >
            {row(item)}
          </div>;
        })}
      </div>
    </div>
  </div>;
}
