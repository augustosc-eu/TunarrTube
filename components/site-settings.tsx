"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { SiteSettingView } from "@/lib/settings/service";

// Settings → Sites: each supported site's requirements (from lib/youtube/sites.ts) and its own yt-dlp
// cookies file and request delay. An empty field saves null, falling back to the global cookies file
// (External tools, above) or the site's built-in delay. Only file *paths* are entered here; TunarrTube
// never reads or shows a cookies file's contents.

const SIGN_IN_BADGES = {
  required: { className: "badge failed", label: "Sign-in required" },
  recommended: { className: "badge pending", label: "Sign-in recommended" },
  optional: { className: "badge", label: "Sign-in optional" },
  none: { className: "badge complete", label: "No account needed" }
} as const;

async function responseData(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body.data as SiteSettingView;
}

function SiteRow({ initial }: { initial: SiteSettingView }) {
  const [view, setView] = useState(initial);
  const [cookiesPath, setCookiesPath] = useState(initial.cookiesPath ?? "");
  const [delay, setDelay] = useState(initial.sleepRequestsSeconds === null ? "" : String(initial.sleepRequestsSeconds));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const badge = SIGN_IN_BADGES[view.signIn.level];
  const dirty = cookiesPath.trim() !== (view.cookiesPath ?? "") || delay.trim() !== (view.sleepRequestsSeconds === null ? "" : String(view.sleepRequestsSeconds));

  async function save() {
    setBusy(true); setMessage(null);
    try {
      const sleepRequestsSeconds = delay.trim() === "" ? null : Number(delay);
      if (sleepRequestsSeconds !== null && (!Number.isInteger(sleepRequestsSeconds) || sleepRequestsSeconds < 0 || sleepRequestsSeconds > 60)) throw new Error("Request delay must be a whole number of seconds from 0 to 60.");
      const next = await responseData(await fetch(`/api/settings/sites/${view.site}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookiesPath: cookiesPath.trim() || null, sleepRequestsSeconds })
      }));
      setView(next);
      setCookiesPath(next.cookiesPath ?? "");
      setDelay(next.sleepRequestsSeconds === null ? "" : String(next.sleepRequestsSeconds));
      setMessage({ tone: "success", text: `Saved ${next.label} settings.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  const cookiesFallback = view.cookiesSource === "global" && !view.cookiesPath ? `Uses the global file: ${view.effectiveCookiesPath}` : "No cookies file";
  return <div className="site-setting">
    <div className="site-setting-header">
      <strong>{view.label}</strong>
      <span className={badge.className}>{badge.label}</span>
    </div>
    <p className="meta">{view.signIn.reason}{view.note ? ` ${view.note}` : ""}</p>
    <p className="meta">{view.supportsStreaming ? "Stream mode available" : "No Stream mode (Download or Cache)"} · {view.hasChannels ? "Channel sources available" : "No channel sources"}</p>
    <div className="form-grid">
      <div className="field">
        <label htmlFor={`site-cookies-${view.site}`}>Cookies file for {view.label}</label>
        <input className="input code" id={`site-cookies-${view.site}`} value={cookiesPath} onChange={(event) => setCookiesPath(event.target.value)} placeholder={cookiesFallback} />
        <span className="meta">Absolute path to a Netscape-format cookies.txt exported from a signed-in browser. Leave empty to fall back to the global file under External tools, if one is set.</span>
      </div>
      <div className="field">
        <label htmlFor={`site-delay-${view.site}`}>Request delay (seconds)</label>
        <input className="input" id={`site-delay-${view.site}`} type="number" min="0" max="60" value={delay} onChange={(event) => setDelay(event.target.value)} placeholder={`Default: ${view.defaultSleepRequestsSeconds}`} />
        <span className="meta">Pause between yt-dlp&apos;s requests to {view.label} while reading pages (not while downloading video). Raise it if {view.label} blocks requests. In effect: {view.effectiveSleepRequestsSeconds}s.</span>
      </div>
    </div>
    <div className="toolbar">
      <button className="button secondary" disabled={busy || !dirty} onClick={save}>{busy && <LoaderCircle size={14} className="animate-spin" />} Save {view.label}</button>
      {message && <span className={message.tone}>{message.text}</span>}
    </div>
  </div>;
}

export function SiteSettings({ sites }: { sites: SiteSettingView[] }) {
  return <div className="card form-card">
    <h2>Sites</h2>
    <p className="meta">What each video site needs, and how yt-dlp talks to it. A site&apos;s own cookies file overrides the global one under External tools. If a site starts refusing requests, TunarrTube pauses that site&apos;s queued jobs and retries them automatically; a cookies file or a longer request delay usually stops it happening.</p>
    {sites.map((site) => <SiteRow key={site.site} initial={site} />)}
  </div>;
}
