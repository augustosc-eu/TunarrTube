"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FolderOpen, Trash2, Wand2 } from "lucide-react";

type RenderedAsset = { id: string; templateId: string; status: string; hasThumbnail: boolean };
type MediaItem = { id: string; title: string; artist: string | null; album: string | null; metadataStatus: string; originType: string; originLocalPath: string | null; downloadStatus: string | null; renders: RenderedAsset[] };
type ChannelItem = { mediaItemId: string; mediaItem: MediaItem };

export function ChannelItemTable({ channelId, templateId, items }: { channelId: string; templateId: string; items: ChannelItem[] }) {
  const router = useRouter();
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<{ done: number; total: number } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [revealing, setRevealing] = useState<string | null>(null);

  async function reveal(renderId: string) {
    setRevealing(renderId);
    try { await fetch(`/api/renders/${renderId}/reveal`, { method: "POST" }); }
    finally { setRevealing(null); }
  }

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  // Queues one render job per not-yet-rendered item, then waits for every one of them to actually
  // finish (transcoding can take minutes per clip) before reporting done -- Publish requires every
  // item to already have a complete render (lib/tunarr/channel-service.ts:publishChannelToTunarr), so
  // returning as soon as the jobs are merely *queued* let people hit "Publish" while rendering was
  // still in flight and get back a wall of unrendered titles instead of a usable next step.
  async function renderAll() {
    setRendering(true);
    setRenderError(null);
    setRenderProgress(null);
    try {
      const response = await fetch(`/api/channels/${channelId}/render`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not queue rendering.");
      const jobIds: string[] = body.data?.jobIds ?? [];
      if (jobIds.length) {
        setRenderProgress({ done: 0, total: jobIds.length });
        const failures: string[] = [];
        let done = 0;
        for (const jobId of jobIds) {
          for (;;) {
            const jobResponse = await fetch(`/api/jobs/${jobId}`);
            const jobBody = await jobResponse.json();
            const status = jobBody.data?.status;
            if (status === "complete") break;
            if (status === "failed" || status === "cancelled") { failures.push(jobBody.data?.error ?? `Render ${status}.`); break; }
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
          done += 1;
          setRenderProgress({ done, total: jobIds.length });
        }
        if (failures.length) throw new Error(failures[0]);
      }
      router.refresh();
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : "Rendering failed");
    } finally {
      setRendering(false);
      setRenderProgress(null);
    }
  }

  async function remove(mediaItemId: string) {
    setRemoving(mediaItemId);
    try {
      await fetch(`/api/channels/${channelId}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaItemId })
      });
      router.refresh();
    } finally {
      setRemoving(null);
    }
  }

  async function bulkRemove() {
    if (!window.confirm(`Remove ${selected.size} item${selected.size === 1 ? "" : "s"} from this channel?`)) return;
    setBulkBusy(true);
    try {
      await Promise.allSettled([...selected].map((mediaItemId) => fetch(`/api/channels/${channelId}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaItemId })
      })));
      setSelected(new Set());
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  if (!items.length) {
    return <div className="empty"><h2>No media yet</h2><p>Add a local folder, an already-downloaded video, or a YouTube URL above to start building this channel.</p></div>;
  }

  return (
    <>
      <div className="toolbar">
        {selected.size > 0
          ? <button className="button secondary" type="button" onClick={bulkRemove} disabled={bulkBusy}><Trash2 size={15} /> Remove selected ({selected.size})</button>
          : null}
        <span className="spacer" />
        <button className="button" type="button" onClick={renderAll} disabled={rendering}>
          <Wand2 size={16} /> {rendering ? (renderProgress ? `Rendering ${renderProgress.done}/${renderProgress.total}…` : "Queuing…") : "Render all"}
        </button>
      </div>
      {renderError ? <p className="error">{renderError}</p> : null}
      <div className="table-wrap responsive-table">
        <table>
          <thead>
            <tr><th><input type="checkbox" aria-label="Select all items" checked={items.length > 0 && items.every(({ mediaItem }) => selected.has(mediaItem.id))} onChange={(event) => setSelected(event.target.checked ? new Set(items.map(({ mediaItem }) => mediaItem.id)) : new Set())} /></th><th>Title</th><th>Source</th><th>Metadata</th><th>Render</th><th /></tr>
          </thead>
          <tbody>
            {items.map(({ mediaItem }) => {
              const render = mediaItem.renders.find((entry) => entry.templateId === templateId);
              const hasSourceFile = mediaItem.originType === "local" ? Boolean(mediaItem.originLocalPath) : mediaItem.downloadStatus === "complete";
              return (
                <tr key={mediaItem.id}>
                  <td data-label="Select"><input type="checkbox" checked={selected.has(mediaItem.id)} onChange={() => toggle(mediaItem.id)} aria-label={`Select ${mediaItem.title}`} /></td>
                  <td className="title-cell" data-label="Title">
                    <strong><Link href={`/channels/${channelId}/items/${mediaItem.id}`}>{mediaItem.title}</Link></strong>
                    <div className="meta">{mediaItem.artist ?? "—"}{mediaItem.album ? ` · ${mediaItem.album}` : ""}</div>
                  </td>
                  <td data-label="Source"><span className="badge">{mediaItem.originType}</span></td>
                  <td data-label="Metadata"><span className={`badge ${mediaItem.metadataStatus}`}>{mediaItem.metadataStatus}</span></td>
                  <td data-label="Render">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {render?.status === "complete" && render.hasThumbnail ? (
                        <Link href={`/channels/${channelId}/items/${mediaItem.id}`}>
                          <Image src={`/api/thumbnails/render/${render.id}`} alt="" width={48} height={27} unoptimized style={{ objectFit: "cover", borderRadius: 4, display: "block" }} />
                        </Link>
                      ) : null}
                      <span className={`badge ${render?.status ?? "pending"}`}>{render?.status ?? (hasSourceFile ? "not rendered" : "no source yet")}</span>
                      {render?.status === "complete" ? (
                        <button className="button secondary" aria-label="Show in file manager" title="Show in file manager" onClick={() => reveal(render.id)} disabled={revealing === render.id}><FolderOpen size={14} /></button>
                      ) : null}
                    </div>
                  </td>
                  <td data-label="Remove"><button className="button secondary" aria-label="Remove" onClick={() => remove(mediaItem.id)} disabled={removing === mediaItem.id}><Trash2 size={15} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
