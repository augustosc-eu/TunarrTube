"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2, Wand2 } from "lucide-react";

type RenderedAsset = { templateId: string; status: string };
type MediaItem = { id: string; title: string; artist: string | null; album: string | null; metadataStatus: string; originType: string; originLocalPath: string | null; downloadStatus: string | null; renders: RenderedAsset[] };
type ChannelItem = { mediaItemId: string; mediaItem: MediaItem };

export function ChannelItemTable({ channelId, templateId, items }: { channelId: string; templateId: string; items: ChannelItem[] }) {
  const router = useRouter();
  const [rendering, setRendering] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  async function renderAll() {
    setRendering(true);
    try {
      await fetch(`/api/channels/${channelId}/render`, { method: "POST" });
      router.refresh();
    } finally {
      setRendering(false);
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

  if (!items.length) {
    return <div className="empty"><h2>No media yet</h2><p>Add a local folder, an already-downloaded video, or a YouTube URL above to start building this channel.</p></div>;
  }

  return (
    <>
      <div className="toolbar">
        <span className="spacer" />
        <button className="button" type="button" onClick={renderAll} disabled={rendering}><Wand2 size={16} /> {rendering ? "Queuing…" : "Render all"}</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Title</th><th>Source</th><th>Metadata</th><th>Render</th><th /></tr>
          </thead>
          <tbody>
            {items.map(({ mediaItem }) => {
              const render = mediaItem.renders.find((entry) => entry.templateId === templateId);
              const hasSourceFile = mediaItem.originType === "local" ? Boolean(mediaItem.originLocalPath) : mediaItem.downloadStatus === "complete";
              return (
                <tr key={mediaItem.id}>
                  <td className="title-cell">
                    <strong><Link href={`/channels/${channelId}/items/${mediaItem.id}`}>{mediaItem.title}</Link></strong>
                    <div className="meta">{mediaItem.artist ?? "—"}{mediaItem.album ? ` · ${mediaItem.album}` : ""}</div>
                  </td>
                  <td><span className="badge">{mediaItem.originType}</span></td>
                  <td><span className={`badge ${mediaItem.metadataStatus}`}>{mediaItem.metadataStatus}</span></td>
                  <td><span className={`badge ${render?.status ?? "pending"}`}>{render?.status ?? (hasSourceFile ? "not rendered" : "no source yet")}</span></td>
                  <td><button className="button secondary" aria-label="Remove" onClick={() => remove(mediaItem.id)} disabled={removing === mediaItem.id}><Trash2 size={15} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
