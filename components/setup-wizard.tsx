"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle, XCircle } from "lucide-react";
import { DirectoryPicker } from "@/components/directory-picker";

type BinaryStatus = { name: string; found: boolean; path: string | null; version: string | null; error?: string };
type TunarrStatus = { connected: boolean; version: { tunarr: string } };

const STEPS = ["Welcome", "Storage", "Tunarr", "Tools", "Finish"] as const;

async function responseData(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body.data;
}

export function SetupWizard({ initialDirectory, initialTunarrUrl, ytDlp, ffmpeg, rerun }: { initialDirectory: string; initialTunarrUrl: string; ytDlp: BinaryStatus; ffmpeg: BinaryStatus; rerun: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [directory, setDirectory] = useState(initialDirectory);
  const [tunarrUrl, setTunarrUrl] = useState(initialTunarrUrl);
  const [tunarr, setTunarr] = useState<TunarrStatus | null>(null);
  const [binaries, setBinaries] = useState({ "yt-dlp": ytDlp, ffmpeg });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function go(next: number) { setError(null); setStep(next); }

  async function testTunarr() {
    setBusy("tunarr"); setError(null); setTunarr(null);
    try {
      setTunarr(await responseData(await fetch("/api/system/test-tunarr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tunarrUrl }) })));
    } catch (testError) { setError(testError instanceof Error ? testError.message : "Couldn't reach Tunarr"); }
    finally { setBusy(null); }
  }

  async function testBinary(name: "yt-dlp" | "ffmpeg") {
    setBusy(name); setError(null);
    try {
      const data = await responseData(await fetch(`/api/system/test-${name === "yt-dlp" ? "ytdlp" : "ffmpeg"}`, { method: "POST" }));
      setBinaries((current) => ({ ...current, [name]: data }));
    } catch (testError) { setError(testError instanceof Error ? testError.message : "Test failed"); }
    finally { setBusy(null); }
  }

  async function finish(destination: string) {
    setBusy("finish"); setError(null);
    try {
      await responseData(await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaBaseDirectory: directory, tunarrUrl }) }));
      router.push(destination);
      router.refresh();
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : "Couldn't save settings");
      setBusy(null);
    }
  }

  const toolsMissing = !binaries["yt-dlp"].found || !binaries.ffmpeg.found;

  return <div className="card form-card">
    <ol className="setup-steps">
      {STEPS.map((label, index) => <li key={label} className={index === step ? "current" : index < step ? "done" : undefined}>{index < step ? <CheckCircle2 size={13} /> : <span>{index + 1}</span>} {label}</li>)}
    </ol>

    {step === 0 && <>
      <h2>{rerun ? "Run setup again" : "Welcome to TunarrTube"}</h2>
      <p className="muted">TunarrTube downloads videos from YouTube and other sites into a folder on this machine, and turns them into Tunarr channels. This takes a minute: pick where videos are stored, point TunarrTube at your Tunarr server, and check the download tools are installed.</p>
      <p className="muted">Everything here can be changed later in Settings.</p>
    </>}

    {step === 1 && <>
      <h2>Where should videos be stored?</h2>
      <div className="field">
        <label htmlFor="setup-media-directory">Media directory</label>
        <DirectoryPicker id="setup-media-directory" value={directory} onChange={setDirectory} />
        <span className="meta">Each source gets its own subfolder here. Pick a drive with plenty of free space, and make sure Tunarr can see this folder too (add a path mapping in Settings if Tunarr sees it under a different path, e.g. in Docker).</span>
      </div>
    </>}

    {step === 2 && <>
      <h2>Connect to Tunarr</h2>
      <div className="field">
        <label htmlFor="setup-tunarr-url">Tunarr URL</label>
        <input className="input code" id="setup-tunarr-url" value={tunarrUrl} onChange={(event) => { setTunarrUrl(event.target.value); setTunarr(null); }} placeholder="http://127.0.0.1:8000" />
        <span className="meta">The address you open Tunarr at in your browser. You can skip the test and connect later.</span>
      </div>
      <div className="toolbar">
        <button className="button secondary" type="button" disabled={Boolean(busy)} onClick={testTunarr}>{busy === "tunarr" && <LoaderCircle size={14} className="animate-spin" />} Test connection</button>
        {tunarr?.connected && <span className="success"><CheckCircle2 size={14} className="inline-icon" />Connected to Tunarr {tunarr.version.tunarr}</span>}
      </div>
    </>}

    {step === 3 && <>
      <h2>Download tools</h2>
      <p className="muted">TunarrTube uses yt-dlp to download videos and FFmpeg to process them.</p>
      {(["yt-dlp", "ffmpeg"] as const).map((name) => {
        const status = binaries[name];
        return <div className="system-row" key={name}>
          <strong>{name}</strong>
          <div><span className={status.found ? "success" : "error-text"}>{status.found ? <CheckCircle2 size={14} className="inline-icon" /> : <XCircle size={14} className="inline-icon" />}{status.found ? "Found" : "Not found"}</span><div className="code muted">{status.path ?? status.error}</div><div className="meta">{status.version}</div></div>
          <div className="toolbar system-row-actions"><button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => testBinary(name)}>{busy === name && <LoaderCircle size={14} className="animate-spin" />} Check again</button></div>
        </div>;
      })}
      {toolsMissing && <p className="meta">Install the missing tool and click Check again, or set its path with TUNARRTUBE_YTDLP_PATH / TUNARRTUBE_FFMPEG_PATH. You can finish setup now, but downloads will fail until both are found.</p>}
    </>}

    {step === 4 && <>
      <h2>Ready to go</h2>
      <dl className="setup-summary">
        <dt>Media directory</dt><dd className="code">{directory}</dd>
        <dt>Tunarr</dt><dd className="code">{tunarrUrl}{tunarr?.connected ? <span className="success"> (connected)</span> : <span className="muted"> (not tested)</span>}</dd>
        <dt>Tools</dt><dd>{toolsMissing ? <span className="error-text">Missing {[!binaries["yt-dlp"].found && "yt-dlp", !binaries.ffmpeg.found && "FFmpeg"].filter(Boolean).join(" and ")}</span> : <span className="success">yt-dlp and FFmpeg found</span>}</dd>
      </dl>
    </>}

    {error && <div className="error">{error}</div>}

    <div className="setup-actions">
      {step > 0 && <button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => go(step - 1)}><ArrowLeft size={15} /> Back</button>}
      <span className="spacer" />
      {step < STEPS.length - 1
        ? <button className="button" type="button" disabled={(step === 1 && !directory.trim()) || (step === 2 && !tunarrUrl.trim())} onClick={() => go(step + 1)}>{step === 0 ? "Get started" : "Next"} <ArrowRight size={15} /></button>
        : <>
          <button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => finish("/")}>Finish</button>
          <button className="button" type="button" disabled={Boolean(busy)} onClick={() => finish("/sources/new")}>{busy === "finish" && <LoaderCircle size={14} className="animate-spin" />} Finish and add a source</button>
        </>}
    </div>
  </div>;
}
