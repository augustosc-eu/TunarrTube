"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Link as LinkIcon, ListVideo, Plus } from "lucide-react";

// A downloaded video, as returned by GET /api/videos -- filtered client-side to the SourceVideo
// pairings that have actually finished downloading, since rendering needs one concrete local file.
type ExistingVideo = {
  id: string;
  title: string;
  sources: Array<{ id: string; sourceId: string; downloadStatus: string; source: { name: string } }>;
};

function completedPairings(videos: ExistingVideo[]) {
  return videos.flatMap((video) =>
    video.sources.filter((membership) => membership.downloadStatus === "complete").map((membership) => ({
      sourceVideoId: membership.id,
      label: `${video.title} — ${membership.source.name}`
    }))
  );
}

export function AddChannelItemsForm({ channelId }: { channelId: string }) {
  const router = useRouter();
  const [folder, setFolder] = useState("");
  const [url, setUrl] = useState("");
  const [existing, setExisting] = useState<Array<{ sourceVideoId: string; label: string }>>([]);
  const [sourceVideoId, setSourceVideoId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"folder" | "url" | "existing" | null>(null);
  const loadedExisting = useRef(false);

  useEffect(() => {
    if (loadedExisting.current) return;
    loadedExisting.current = true;
    fetch("/api/videos").then((response) => response.json()).then((body) => {
      if (Array.isArray(body.data)) setExisting(completedPairings(body.data as ExistingVideo[]));
    }).catch(() => { /* best-effort */ });
  }, []);

  async function submit(payload: { type: "local"; folder: string } | { type: "youtube"; url: string } | { type: "existingVideo"; sourceVideoId: string }) {
    setBusy(payload.type === "local" ? "folder" : payload.type === "youtube" ? "url" : "existing");
    setError(null);
    try {
      const response = await fetch(`/api/channels/${channelId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not add media.");
      setFolder("");
      setUrl("");
      setSourceVideoId("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h2>Add media</h2>
      {existing.length ? (
        <div className="form-grid">
          <div className="field">
            <label htmlFor="existing-video">Already-downloaded video</label>
            <select id="existing-video" className="input" value={sourceVideoId} onChange={(event) => setSourceVideoId(event.target.value)}>
              <option value="">Choose a video…</option>
              {existing.map((item) => <option key={item.sourceVideoId} value={item.sourceVideoId}>{item.label}</option>)}
            </select>
          </div>
          <button className="button secondary" type="button" disabled={!sourceVideoId || busy !== null} onClick={() => submit({ type: "existingVideo", sourceVideoId })}>
            <ListVideo size={16} /> {busy === "existing" ? "Adding…" : "Add"}
          </button>
        </div>
      ) : null}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="folder-path">Local folder (absolute path)</label>
          <input id="folder-path" className="input" value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="/absolute/path/to/videos" />
        </div>
        <button className="button secondary" type="button" disabled={!folder.trim() || busy !== null} onClick={() => submit({ type: "local", folder })}>
          <FolderOpen size={16} /> {busy === "folder" ? "Scanning…" : "Scan folder"}
        </button>
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="youtube-url">YouTube video URL</label>
          <input id="youtube-url" className="input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
        </div>
        <button className="button secondary" type="button" disabled={!url.trim() || busy !== null} onClick={() => submit({ type: "youtube", url })}>
          <LinkIcon size={16} /> {busy === "url" ? "Adding…" : "Add"}
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <p className="muted"><Plus size={13} className="inline-icon" />Pasting a URL downloads it through a Source dedicated to this channel (visible under Sources); scanning a folder queues background work — refresh this page in a moment to see new items.</p>
    </div>
  );
}
