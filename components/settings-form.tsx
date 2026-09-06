"use client";

import { useState } from "react";
import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";

type BinaryStatus = { name: string; found: boolean; path: string | null; version: string | null; error?: string };
type TunarrStatus = { connected: boolean; version: { tunarr: string; ffmpeg: string; nodejs: string }; capabilities: Record<string, boolean> };

type Mapping = { ytarrPrefix: string; tunarrPrefix: string };
export const VIDEO_QUALITY_OPTIONS = [
  { value: "best", label: "Best available (no cap)" },
  { value: "2160p", label: "2160p (4K)" },
  { value: "1440p", label: "1440p (QHD)" },
  { value: "1080p", label: "1080p (Full HD)" },
  { value: "720p", label: "720p (HD)" },
  { value: "480p", label: "480p (SD)" }
];
export function SettingsForm({ initialDirectory, initialTunarrUrl, initialCacheMegabytes, initialCacheAgeDays, initialLogRetentionDays, initialDefaultVideoQuality, initialMusicbrainzContactEmail, initialMappings, ytDlp, ffmpeg }: { initialDirectory: string; initialTunarrUrl: string; initialCacheMegabytes: number; initialCacheAgeDays: number; initialLogRetentionDays: number; initialDefaultVideoQuality: string; initialMusicbrainzContactEmail: string | null; initialMappings: Mapping[]; ytDlp: BinaryStatus; ffmpeg: BinaryStatus }) {
  const [directory, setDirectory] = useState(initialDirectory);
  const [tunarrUrl, setTunarrUrl] = useState(initialTunarrUrl);
  const [cacheMegabytes, setCacheMegabytes] = useState(String(initialCacheMegabytes));
  const [cacheAgeDays, setCacheAgeDays] = useState(String(initialCacheAgeDays));
  const [logRetentionDays, setLogRetentionDays] = useState(String(initialLogRetentionDays));
  const [videoQuality, setVideoQuality] = useState(initialDefaultVideoQuality);
  const [musicbrainzContactEmail, setMusicbrainzContactEmail] = useState(initialMusicbrainzContactEmail ?? "");
  const [mappings, setMappings] = useState<Mapping[]>(initialMappings.map(({ ytarrPrefix, tunarrPrefix }) => ({ ytarrPrefix, tunarrPrefix })));
  const [preview, setPreview] = useState<string | null>(null);
  const [binaries, setBinaries] = useState({ "yt-dlp": ytDlp, ffmpeg });
  const [tunarr, setTunarr] = useState<TunarrStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error">("error");

  async function responseData(response: Response) {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
    return body.data;
  }

  async function testBinary(name: "yt-dlp" | "ffmpeg") {
    setBusy(name); setMessage(null);
    try {
      const data = await responseData(await fetch(`/api/system/test-${name === "yt-dlp" ? "ytdlp" : "ffmpeg"}`, { method: "POST" }));
      setBinaries((current) => ({ ...current, [name]: data }));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Test failed"); setMessageTone("error"); }
    finally { setBusy(null); }
  }

  async function updateYtDlp() {
    setBusy("yt-dlp-update"); setMessage(null);
    try {
      const data = await responseData(await fetch("/api/system/update-ytdlp", { method: "POST" }));
      setBinaries((current) => ({ ...current, "yt-dlp": { ...current["yt-dlp"], version: data.version } }));
      setMessage(data.message); setMessageTone("success");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Update failed"); setMessageTone("error"); }
    finally { setBusy(null); }
  }

  async function testTunarr() {
    setBusy("tunarr"); setMessage(null); setTunarr(null);
    try {
      const data = await responseData(await fetch("/api/system/test-tunarr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tunarrUrl }) }));
      setTunarr(data);
      setMessage(`Connected to Tunarr ${data.version.tunarr}. This test is read-only; open a TunarrTube source and choose Create Tunarr Channel to publish it.`); setMessageTone("success");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Tunarr test failed"); setMessageTone("error"); }
    finally { setBusy(null); }
  }

  async function repairMetadata() {
    setBusy("repair"); setMessage(null);
    try {
      const data = await responseData(await fetch("/api/system/repair-metadata", { method: "POST" }));
      setMessage(`Queued metadata repair for ${data.queued} video${data.queued === 1 ? "" : "s"}.`); setMessageTone("success");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Repair failed"); setMessageTone("error"); }
    finally { setBusy(null); }
  }

  async function save() {
    setBusy("settings"); setMessage(null);
    try {
      const data = await responseData(await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaBaseDirectory: directory, tunarrUrl, cacheMaxMegabytes: Number(cacheMegabytes), cacheMaxAgeDays: Number(cacheAgeDays), logRetentionDays: Number(logRetentionDays), defaultVideoQuality: videoQuality, musicbrainzContactEmail: musicbrainzContactEmail.trim() || null, pathMappings: mappings }) }));
      setDirectory(data.mediaBaseDirectory); setTunarrUrl(data.tunarrUrl);
      setMessage(`Settings saved. Updated ${data.updatedSources} existing source destination${data.updatedSources === 1 ? "" : "s"}.`); setMessageTone("success");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); setMessageTone("error"); }
    finally { setBusy(null); }
  }

  async function previewMapping() { setMessage(null); setPreview(null); try { const value = await responseData(await fetch("/api/settings/path-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: directory, mappings }) })); setPreview(value.output); } catch (error) { setMessage(error instanceof Error ? error.message : "Path preview failed"); setMessageTone("error"); } }

  return <div className="card form-card">
    <h2>External tools</h2>
    {(["yt-dlp", "ffmpeg"] as const).map((name) => {
      const status = binaries[name];
      return <div className="system-row" key={name}>
        <strong>{name}</strong>
        <div><span className={status.found ? "success" : "error"}>{status.found ? <CheckCircle2 size={14} className="inline-icon" /> : <XCircle size={14} className="inline-icon" />}{status.found ? "Found" : "Not found"}</span><div className="code muted">{status.path ?? status.error}</div><div className="meta">{status.version}</div></div>
        <div className="toolbar system-row-actions">
          <button className="button secondary" disabled={Boolean(busy)} onClick={() => testBinary(name)}>{busy === name && <LoaderCircle size={14} className="animate-spin" />} Test</button>
          {name === "yt-dlp" && <button className="button secondary" disabled={Boolean(busy)} onClick={updateYtDlp}>{busy === "yt-dlp-update" && <LoaderCircle size={14} className="animate-spin" />} Update</button>}
        </div>
      </div>;
    })}

    <h2 className="section-heading">Media</h2>
    <div className="field"><label htmlFor="media-directory">Base media directory</label><input className="input code" id="media-directory" value={directory} onChange={(event) => setDirectory(event.target.value)} /><span className="meta">Must be an absolute readable and writable path. Existing sources use this base for future downloads; completed files stay at their recorded paths.</span></div>
    <div className="form-grid"><div className="field"><label htmlFor="cache-size">Cache size (MB)</label><input className="input" id="cache-size" type="number" min="128" value={cacheMegabytes} onChange={(event) => setCacheMegabytes(event.target.value)} /></div><div className="field"><label htmlFor="cache-age">Maximum idle age (days)</label><input className="input" id="cache-age" type="number" min="1" value={cacheAgeDays} onChange={(event) => setCacheAgeDays(event.target.value)} /></div><div className="field"><label htmlFor="log-retention">Log retention (days)</label><input className="input" id="log-retention" type="number" min="1" value={logRetentionDays} onChange={(event) => setLogRetentionDays(event.target.value)} /></div></div>
    <div className="field"><label htmlFor="default-video-quality">Default video quality</label><select className="input" id="default-video-quality" value={videoQuality} onChange={(event) => setVideoQuality(event.target.value)}>{VIDEO_QUALITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="meta">Applied to every source that doesn&apos;t set its own quality override.</span></div>

    <h2 className="section-heading">Channels</h2>
    <div className="field"><label htmlFor="musicbrainz-email">MusicBrainz contact email</label><input className="input" id="musicbrainz-email" type="email" value={musicbrainzContactEmail} onChange={(event) => setMusicbrainzContactEmail(event.target.value)} placeholder="you@example.com" /><span className="meta">Sent as MusicBrainz&apos;s required API contact identifier when looking up metadata for a channel&apos;s media items.</span></div>

    <h2 className="section-heading">Tunarr</h2>
    <div className="field"><label htmlFor="tunarr-url">Tunarr URL</label><input className="input code" id="tunarr-url" type="url" value={tunarrUrl} onChange={(event) => { setTunarrUrl(event.target.value); setTunarr(null); }} /><span className="meta">TunarrTube discovers the configured server&apos;s OpenAPI contract before creating or updating channels.</span></div>
    <div className="toolbar"><button className="button secondary" disabled={Boolean(busy)} onClick={testTunarr}>{busy === "tunarr" && <LoaderCircle size={14} className="animate-spin" />} Test Tunarr</button>{tunarr && <span className="success"><CheckCircle2 size={14} className="inline-icon" />API {tunarr.version.tunarr} · {Object.values(tunarr.capabilities).filter(Boolean).length}/{Object.keys(tunarr.capabilities).length} capabilities</span>}</div>
    <div className="toolbar"><button className="button secondary" disabled={Boolean(busy)} onClick={repairMetadata}>{busy === "repair" && <LoaderCircle size={14} className="animate-spin" />} Repair video metadata</button><span className="meta">Re-embeds title/description into already-downloaded files and refreshes linked Tunarr channels.</span></div>
    <h2 className="section-heading">Tunarr path mappings</h2><p>Mappings use longest-prefix matching. Leave the table empty when both applications see identical paths.</p>
    {mappings.map((mapping, index) => <div className="form-grid" key={index}><div className="field"><label htmlFor={`ytarr-prefix-${index}`}>TunarrTube prefix</label><input className="input code" id={`ytarr-prefix-${index}`} value={mapping.ytarrPrefix} onChange={(event) => setMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ytarrPrefix: event.target.value } : item))}/></div><div className="field"><label htmlFor={`tunarr-prefix-${index}`}>Tunarr prefix</label><input className="input code" id={`tunarr-prefix-${index}`} value={mapping.tunarrPrefix} onChange={(event) => setMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, tunarrPrefix: event.target.value } : item))}/></div><button className="button secondary" type="button" onClick={() => setMappings((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div>)}
    <div className="toolbar"><button className="button secondary" type="button" onClick={() => setMappings((current) => [...current, { ytarrPrefix: directory, tunarrPrefix: "/media" }])}>Add mapping</button><button className="button secondary" type="button" onClick={previewMapping}>Preview media path</button>{preview ? <span className="code success">{preview}</span> : null}</div>

    <button className="button" disabled={Boolean(busy)} onClick={save}>{busy === "settings" && <LoaderCircle size={14} className="animate-spin" />} Save Settings</button>
    {message && <p className={messageTone}>{message}</p>}
  </div>;
}
