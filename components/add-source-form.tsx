"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ListVideo, LoaderCircle, Search } from "lucide-react";
import { VIDEO_QUALITY_OPTIONS } from "@/components/settings-form";

type Draft = { id: string; name: string; uploaderName: string | null; thumbnailUrl: string | null; videoCount: number; sourceType: "playlist" | "channel" | "collection"; feedType: string; historyLimit: number | null };
async function data(response: Response) { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Request failed"); return body.data; }

export function AddSourceForm() {
  const router = useRouter();
  const [url, setUrl] = useState(""); const [draft, setDraft] = useState<Draft | null>(null); const [name, setName] = useState("");
  const [feedType, setFeedType] = useState("videos"); const [history, setHistory] = useState("100"); const [mode, setMode] = useState("download");
  const [customHistory, setCustomHistory] = useState("25");
  const [videoQuality, setVideoQuality] = useState("");
  const [syncEnabled, setSyncEnabled] = useState(false); const [interval, setIntervalValue] = useState("360");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const looksLikeChannel = /youtube\.com\/(?:@|channel\/|user\/|c\/)/i.test(url) && !/[?&]list=/.test(url);

  async function analyze(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setDraft(null);
    try {
      const body = { url, ...(looksLikeChannel ? { feedType, historyLimit: history === "unlimited" ? null : Number(history === "custom" ? customHistory : history) } : {}) };
      const next = await data(await fetch("/api/sources/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      setDraft(next); setName(next.name);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Analysis failed"); } finally { setBusy(false); }
  }
  async function create() {
    if (!draft) return; setBusy(true); setError(null);
    try {
      const source = await data(await fetch("/api/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId: draft.id, name, playbackMode: mode, videoQuality: videoQuality || null, syncEnabled: draft.sourceType === "collection" ? false : syncEnabled, syncIntervalMinutes: Number(interval) }) }));
      router.push(`/sources/${source.id}`); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Source creation failed"); setBusy(false); }
  }
  return <div className="card form-card"><form onSubmit={analyze}>
    <div className="field"><label htmlFor="youtube-url">YouTube video, playlist, or channel URL</label><input className="input" id="youtube-url" type="url" required disabled={busy} placeholder="https://youtu.be/video-id" value={url} onChange={(event) => { setUrl(event.target.value); setDraft(null); }} /></div>
    {looksLikeChannel ? <div className="form-grid">
      <div className="field">
        <label htmlFor="feed-type">Channel feed</label>
        <select className="input" id="feed-type" value={feedType} disabled={busy} onChange={(event) => { setFeedType(event.target.value); setDraft(null); }}>
          <option value="videos">Videos</option><option value="shorts">Shorts</option><option value="live">Live archives</option><option value="all">All feeds</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="history-limit">History</label>
        <select className="input" id="history-limit" value={history} disabled={busy} onChange={(event) => { setHistory(event.target.value); setDraft(null); }}>
          {[15, 25, 50, 75, 100, 250, 500].map((amount) => <option key={amount} value={amount}>Latest {amount}</option>)}
          <option value="custom">Custom</option><option value="unlimited">Unlimited</option>
        </select>
        {history === "custom" ? <>
          <label htmlFor="custom-history-limit">Number of latest videos</label>
          <input className="input" id="custom-history-limit" type="number" min={1} max={5000} step={1} required value={customHistory} disabled={busy} aria-describedby="custom-history-help" onChange={(event) => { setCustomHistory(event.target.value); setDraft(null); }} />
          <small id="custom-history-help">Enter a whole number from 1 to 5,000.</small>
        </> : null}
      </div>
    </div> : null}
    <button className="button" disabled={busy}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Search size={16} />} Analyze Source</button>
  </form>{error ? <div className="error" role="alert">{error}</div> : null}{draft ? <section className="preview">{draft.thumbnailUrl ? <Image className="source-thumb" src={draft.thumbnailUrl} width={240} height={180} alt="" /> : <div className="source-thumb placeholder"><ListVideo /></div>}<div>
    <div className="field"><label htmlFor="source-name">Source name</label><input className="input" id="source-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
    <div className="meta"><span>YouTube {draft.sourceType}</span><span>·</span><span>{draft.videoCount} detected videos</span>{draft.uploaderName ? <><span>·</span><span>{draft.uploaderName}</span></> : null}</div>
    <div className="field section-heading"><label htmlFor="playback-mode">Playback mode</label><select className="input" id="playback-mode" value={mode} onChange={(event) => setMode(event.target.value)}><option value="download">Permanent — download automatically</option><option value="cache">Cache — download on first play</option><option value="stream">Stream — no local retention</option></select></div>
    <div className="field"><label htmlFor="video-quality">Video quality</label><select className="input" id="video-quality" value={videoQuality} onChange={(event) => setVideoQuality(event.target.value)}><option value="">Use default (from Settings)</option>{VIDEO_QUALITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
    {draft.sourceType !== "collection" ? <label className="choice"><span><input type="checkbox" checked={syncEnabled} onChange={(event) => setSyncEnabled(event.target.checked)} /> Automatic synchronization</span>{syncEnabled ? <select value={interval} onChange={(event) => setIntervalValue(event.target.value)}><option value="60">Hourly</option><option value="360">Every 6 hours</option><option value="720">Every 12 hours</option><option value="1440">Daily</option></select> : null}</label> : <p>Add more individual videos from the collection page after creating it.</p>}
    <button className="button" type="button" disabled={busy || !name.trim()} onClick={create}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : null} Add Source</button>
  </div></section> : null}</div>;
}
