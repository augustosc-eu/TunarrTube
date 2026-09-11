"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Link as LinkIcon, ListVideo } from "lucide-react";

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
    <section className="card channel-panel">
      <div className="channel-panel-heading">
        <div>
          <h2>Add media</h2>
          <p>Choose a video already in TunarrTube, scan a local folder, or paste a YouTube link.</p>
        </div>
      </div>
      <div className="add-media-options">
      {existing.length ? (
        <div className="add-media-option">
          <div className="add-media-option-title"><ListVideo size={17} /><h3>From your library</h3></div>
          <div className="field">
            <label htmlFor="existing-video">Downloaded video</label>
            <select id="existing-video" className="input" value={sourceVideoId} onChange={(event) => setSourceVideoId(event.target.value)}>
              <option value="">Choose a video…</option>
              {existing.map((item) => <option key={item.sourceVideoId} value={item.sourceVideoId}>{item.label}</option>)}
            </select>
          </div>
          <button className="button secondary add-media-action" type="button" disabled={!sourceVideoId || busy !== null} onClick={() => submit({ type: "existingVideo", sourceVideoId })}>
            {busy === "existing" ? "Adding…" : "Add video"}
          </button>
        </div>
      ) : null}
      <div className="add-media-option">
        <div className="add-media-option-title"><FolderOpen size={17} /><h3>Local folder</h3></div>
        <div className="field">
          <label htmlFor="folder-path">Absolute path</label>
          <input id="folder-path" className="input" value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="/absolute/path/to/videos" />
        </div>
        <button className="button secondary add-media-action" type="button" disabled={!folder.trim() || busy !== null} onClick={() => submit({ type: "local", folder })}>
          <FolderOpen size={16} /> {busy === "folder" ? "Scanning…" : "Scan folder"}
        </button>
      </div>
      <div className="add-media-option">
        <div className="add-media-option-title"><LinkIcon size={17} /><h3>YouTube link</h3></div>
        <div className="field">
          <label htmlFor="youtube-url">Video URL</label>
          <input id="youtube-url" className="input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
        </div>
        <button className="button secondary add-media-action" type="button" disabled={!url.trim() || busy !== null} onClick={() => submit({ type: "youtube", url })}>
          <LinkIcon size={16} /> {busy === "url" ? "Adding…" : "Add"}
        </button>
      </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <p className="channel-panel-note">YouTube links download through this channel&apos;s Source. Folder scans run in the background, so new items may take a moment to appear.</p>
    </section>
  );
}
