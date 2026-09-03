"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ListVideo, LoaderCircle, Search } from "lucide-react";

type Draft = { id: string; name: string; uploaderName: string | null; thumbnailUrl: string | null; videoCount: number; sourceType: "playlist" | "channel" | "collection"; feedType: string; historyLimit: number | null };
async function data(response: Response) { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Request failed"); return body.data; }

export function AddSourceForm() {
  const router = useRouter();
  const [url, setUrl] = useState(""); const [draft, setDraft] = useState<Draft | null>(null); const [name, setName] = useState("");
  const [feedType, setFeedType] = useState("videos"); const [history, setHistory] = useState("100"); const [mode, setMode] = useState("download");
  const [syncEnabled, setSyncEnabled] = useState(false); const [interval, setIntervalValue] = useState("360");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const looksLikeChannel = /youtube\.com\/(?:@|channel\/|user\/|c\/)/i.test(url) && !/[?&]list=/.test(url);

  async function analyze(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setDraft(null);
    try {
      const body = { url, ...(looksLikeChannel ? { feedType, historyLimit: history === "unlimited" ? null : Number(history) } : {}) };
      const next = await data(await fetch("/api/sources/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      setDraft(next); setName(next.name);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Analysis failed"); } finally { setBusy(false); }
  }
  async function create() {
    if (!draft) return; setBusy(true); setError(null);
    try {
      const source = await data(await fetch("/api/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId: draft.id, name, playbackMode: mode, syncEnabled: draft.sourceType === "collection" ? false : syncEnabled, syncIntervalMinutes: Number(interval) }) }));
      router.push(`/sources/${source.id}`); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Source creation failed"); setBusy(false); }
  }
  return <div className="card form-card"><form onSubmit={analyze}>
    <div className="field"><label htmlFor="youtube-url">YouTube video, playlist, or channel URL</label><input className="input" id="youtube-url" type="url" required placeholder="https://youtu.be/video-id" value={url} onChange={(event) => { setUrl(event.target.value); setDraft(null); }} /></div>
    {looksLikeChannel ? <div className="form-grid"><div className="field"><label htmlFor="feed-type">Channel feed</label><select className="input" id="feed-type" value={feedType} onChange={(event) => setFeedType(event.target.value)}><option value="videos">Videos</option><option value="shorts">Shorts</option><option value="live">Live archives</option><option value="all">All feeds</option></select></div><div className="field"><label htmlFor="history-limit">History</label><select className="input" id="history-limit" value={history} onChange={(event) => setHistory(event.target.value)}><option value="100">Latest 100</option><option value="250">Latest 250</option><option value="500">Latest 500</option><option value="unlimited">Unlimited</option></select></div></div> : null}
    <button className="button" disabled={busy}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Search size={16} />} Analyze Source</button>
  </form>{error ? <div className="error" role="alert">{error}</div> : null}{draft ? <section className="preview">{draft.thumbnailUrl ? <Image className="source-thumb" src={draft.thumbnailUrl} width={240} height={180} alt="" /> : <div className="source-thumb placeholder"><ListVideo /></div>}<div>
    <div className="field"><label htmlFor="source-name">Source name</label><input className="input" id="source-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
    <div className="meta"><span>YouTube {draft.sourceType}</span><span>·</span><span>{draft.videoCount} detected videos</span>{draft.uploaderName ? <><span>·</span><span>{draft.uploaderName}</span></> : null}</div>
    <div className="field section-heading"><label htmlFor="playback-mode">Playback mode</label><select className="input" id="playback-mode" value={mode} onChange={(event) => setMode(event.target.value)}><option value="download">Permanent — download automatically</option><option value="cache">Cache — download on first play</option><option value="stream">Stream — no local retention</option></select></div>
    {draft.sourceType !== "collection" ? <label className="choice"><span><input type="checkbox" checked={syncEnabled} onChange={(event) => setSyncEnabled(event.target.checked)} /> Automatic synchronization</span>{syncEnabled ? <select value={interval} onChange={(event) => setIntervalValue(event.target.value)}><option value="60">Hourly</option><option value="360">Every 6 hours</option><option value="720">Every 12 hours</option><option value="1440">Daily</option></select> : null}</label> : <p>Add more individual videos from the collection page after creating it.</p>}
    <button className="button" type="button" disabled={busy || !name.trim()} onClick={create}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : null} Add Source</button>
  </div></section> : null}</div>;
}
