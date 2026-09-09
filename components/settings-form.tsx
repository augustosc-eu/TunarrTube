"use client";

import { useEffect, useState } from "react";
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
export const NAMING_SCHEME_OPTIONS = [
  { value: "id", label: "YouTube video ID (current default)" },
  { value: "template", label: "Custom filename template" },
  { value: "tvshow", label: "TV show (Emby/Plex/Jellyfin/Tunarr Shows)" }
];

export function SettingsForm({ initialDirectory, initialTunarrUrl, initialCacheMegabytes, initialCacheAgeDays, initialLogRetentionDays, initialDefaultVideoQuality, initialMusicbrainzContactEmail, initialMetadataMusicbrainzEnabled, initialMetadataItunesEnabled, initialMetadataAutoApplyThreshold, initialAiProvider, initialYtdlpCookiesPath, initialMappings, initialDefaultNamingScheme, initialDefaultFilenameTemplate, ytDlp, ffmpeg }: { initialDirectory: string; initialTunarrUrl: string; initialCacheMegabytes: number; initialCacheAgeDays: number; initialLogRetentionDays: number; initialDefaultVideoQuality: string; initialMusicbrainzContactEmail: string | null; initialMetadataMusicbrainzEnabled: boolean; initialMetadataItunesEnabled: boolean; initialMetadataAutoApplyThreshold: number; initialAiProvider: string; initialYtdlpCookiesPath: string | null; initialMappings: Mapping[]; initialDefaultNamingScheme: string; initialDefaultFilenameTemplate: string; ytDlp: BinaryStatus; ffmpeg: BinaryStatus }) {
  const [directory, setDirectory] = useState(initialDirectory);
  const [tunarrUrl, setTunarrUrl] = useState(initialTunarrUrl);
  const [cacheMegabytes, setCacheMegabytes] = useState(String(initialCacheMegabytes));
  const [cacheAgeDays, setCacheAgeDays] = useState(String(initialCacheAgeDays));
  const [logRetentionDays, setLogRetentionDays] = useState(String(initialLogRetentionDays));
  const [videoQuality, setVideoQuality] = useState(initialDefaultVideoQuality);
  const [musicbrainzContactEmail, setMusicbrainzContactEmail] = useState(initialMusicbrainzContactEmail ?? "");
  const [metadataMusicbrainzEnabled, setMetadataMusicbrainzEnabled] = useState(initialMetadataMusicbrainzEnabled);
  const [metadataItunesEnabled, setMetadataItunesEnabled] = useState(initialMetadataItunesEnabled);
  const [metadataAutoApplyThreshold, setMetadataAutoApplyThreshold] = useState(String(initialMetadataAutoApplyThreshold));
  const [aiProvider, setAiProvider] = useState(initialAiProvider);
  const [ytdlpCookiesPath, setYtdlpCookiesPath] = useState(initialYtdlpCookiesPath ?? "");
  const [mappings, setMappings] = useState<Mapping[]>(initialMappings.map(({ ytarrPrefix, tunarrPrefix }) => ({ ytarrPrefix, tunarrPrefix })));
  const [namingScheme, setNamingScheme] = useState(initialDefaultNamingScheme);
  const [filenameTemplate, setFilenameTemplate] = useState(initialDefaultFilenameTemplate);
  const [namingPreview, setNamingPreview] = useState<string | null>(null);
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
      const data = await responseData(await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaBaseDirectory: directory, tunarrUrl, cacheMaxMegabytes: Number(cacheMegabytes), cacheMaxAgeDays: Number(cacheAgeDays), logRetentionDays: Number(logRetentionDays), defaultVideoQuality: videoQuality, musicbrainzContactEmail: musicbrainzContactEmail.trim() || null, metadataMusicbrainzEnabled, metadataItunesEnabled, metadataAutoApplyThreshold: Number(metadataAutoApplyThreshold), aiProvider, ytdlpCookiesPath: ytdlpCookiesPath.trim() || null, pathMappings: mappings, defaultNamingScheme: namingScheme, defaultFilenameTemplate: filenameTemplate }) }));
      setDirectory(data.mediaBaseDirectory); setTunarrUrl(data.tunarrUrl);
      setMessage(`Settings saved. Updated ${data.updatedSources} existing source destination${data.updatedSources === 1 ? "" : "s"}.`); setMessageTone("success");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); setMessageTone("error"); }
    finally { setBusy(null); }
  }

  async function previewMapping() { setMessage(null); setPreview(null); try { const value = await responseData(await fetch("/api/settings/path-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: directory, mappings }) })); setPreview(value.output); } catch (error) { setMessage(error instanceof Error ? error.message : "Path preview failed"); setMessageTone("error"); } }

  async function previewNaming(scheme: string, template: string) { try { const value = await responseData(await fetch("/api/settings/naming-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scheme, template }) })); setNamingPreview(value.path); } catch { setNamingPreview(null); } }

  useEffect(() => { previewNaming(namingScheme, filenameTemplate); }, [namingScheme, filenameTemplate]);

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
    <div className="field"><label htmlFor="ytdlp-cookies-path">yt-dlp cookies file (optional)</label><input className="input code" id="ytdlp-cookies-path" value={ytdlpCookiesPath} onChange={(event) => setYtdlpCookiesPath(event.target.value)} placeholder="/config/cookies.txt" /><span className="meta">Absolute path, inside this container, to a Netscape-format cookies.txt exported from a YouTube account. Without one, age-restricted and bot-checked videos (&ldquo;Sign in to confirm your age/you&apos;re not a bot&rdquo;) are marked unavailable instead of downloading. Export cookies with a browser extension on a machine you control, mount the file read-only into the container (e.g. a docker-compose bind mount), and point this at the mounted path — TunarrTube never generates, uploads, or displays this file&apos;s contents, only passes the path to yt-dlp. Treat it like a password: whoever holds it can act as that YouTube account, and a shared/family account risks a ban if yt-dlp trips YouTube&apos;s automation detection. Leave blank to stay unauthenticated.</span></div>

    <h2 className="section-heading">Media</h2>
    <div className="field"><label htmlFor="media-directory">Base media directory</label><input className="input code" id="media-directory" value={directory} onChange={(event) => setDirectory(event.target.value)} /><span className="meta">Must be an absolute readable and writable path. Existing sources use this base for future downloads; completed files stay at their recorded paths.</span></div>
    <div className="form-grid"><div className="field"><label htmlFor="cache-size">Cache size (MB)</label><input className="input" id="cache-size" type="number" min="128" value={cacheMegabytes} onChange={(event) => setCacheMegabytes(event.target.value)} /></div><div className="field"><label htmlFor="cache-age">Maximum idle age (days)</label><input className="input" id="cache-age" type="number" min="1" value={cacheAgeDays} onChange={(event) => setCacheAgeDays(event.target.value)} /></div><div className="field"><label htmlFor="log-retention">Log retention (days)</label><input className="input" id="log-retention" type="number" min="1" value={logRetentionDays} onChange={(event) => setLogRetentionDays(event.target.value)} /></div></div>
    <div className="field"><label htmlFor="default-video-quality">Default video quality</label><select className="input" id="default-video-quality" value={videoQuality} onChange={(event) => setVideoQuality(event.target.value)}>{VIDEO_QUALITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="meta">Applied to every source that doesn&apos;t set its own quality override.</span></div>

    <h2 className="section-heading">Naming</h2>
    <div className="field"><label htmlFor="naming-scheme">Downloaded filename/folder layout</label><select className="input" id="naming-scheme" value={namingScheme} onChange={(event) => setNamingScheme(event.target.value)}>{NAMING_SCHEME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="meta">Applied to every source that doesn&apos;t set its own naming override. &ldquo;TV show&rdquo; organizes each source as Season &lt;upload year&gt;/, writes Emby/Plex/Jellyfin-compatible episode NFOs, and matches a Tunarr &ldquo;Shows&rdquo; local media library instead of &ldquo;Other Videos&rdquo; if one is configured. Changing this only affects future downloads — already-downloaded files keep their current names and location.</span></div>
    {namingScheme === "template" && <div className="field"><label htmlFor="filename-template">Filename template</label><input className="input code" id="filename-template" value={filenameTemplate} onChange={(event) => setFilenameTemplate(event.target.value)} placeholder="{channel} - {title}" /><span className="meta">Variables: <code>{"{title}"}</code>, <code>{"{channel}"}</code>, <code>{"{date}"}</code> (YYYY-MM-DD), <code>{"{year}"}</code>, <code>{"{videoId}"}</code>. A literal &ldquo;/&rdquo; creates a subfolder, e.g. <code>{"{channel}/{title}"}</code>. The YouTube video ID is always appended in brackets if the template doesn&apos;t already include it, so Tunarr can still match the file.</span></div>}
    {namingPreview && <p className="code muted">{namingPreview}</p>}

    <h2 className="section-heading">Channels</h2>
    <div className="field"><label htmlFor="musicbrainz-email">MusicBrainz contact email</label><input className="input" id="musicbrainz-email" type="email" value={musicbrainzContactEmail} onChange={(event) => setMusicbrainzContactEmail(event.target.value)} placeholder="you@example.com" /><span className="meta">Sent as MusicBrainz&apos;s required API contact identifier when looking up metadata for a channel&apos;s media items.</span></div>
    <div className="form-grid">
      <div className="field"><label htmlFor="metadata-musicbrainz-enabled"><input id="metadata-musicbrainz-enabled" type="checkbox" checked={metadataMusicbrainzEnabled} onChange={(event) => setMetadataMusicbrainzEnabled(event.target.checked)} /> MusicBrainz lookups</label></div>
      <div className="field"><label htmlFor="metadata-itunes-enabled"><input id="metadata-itunes-enabled" type="checkbox" checked={metadataItunesEnabled} onChange={(event) => setMetadataItunesEnabled(event.target.checked)} /> iTunes lookups</label></div>
      <div className="field"><label htmlFor="metadata-auto-apply-threshold">Auto-apply confidence threshold</label><input className="input" id="metadata-auto-apply-threshold" type="number" min="0" max="100" value={metadataAutoApplyThreshold} onChange={(event) => setMetadataAutoApplyThreshold(event.target.value)} /></div>
    </div>
    <span className="meta">When a media item is added to a channel with no artist (a synced video whose YouTube tags didn&apos;t supply one, or a local file), TunarrTube automatically searches the lookups enabled above and applies the best match scoring at or above this threshold (0-100). Lower catches more matches but risks the wrong artist; raise to be conservative. A weaker match is still visible for manual review in the media item editor&apos;s own Search.</span>
    <div className="field"><label htmlFor="ai-provider">AI programming provider</label><select className="input" id="ai-provider" value={aiProvider} onChange={(event) => setAiProvider(event.target.value)}><option value="auto">Auto-detect from configured API key</option><option value="anthropic">Anthropic (Claude)</option><option value="openai">OpenAI</option></select><span className="meta">Default for any source or channel using &ldquo;AI Programming&rdquo; order that doesn&apos;t set its own provider. Requires <code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code> in the environment — no key is stored here.</span></div>

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
