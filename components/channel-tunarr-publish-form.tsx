"use client";

import { useEffect, useState } from "react";
import { Radio } from "lucide-react";

type LinkStatus = {
  linked: boolean;
  mediaSourceFound: boolean;
  libraryFound: boolean;
  channelFound: boolean;
  channel?: { name: string; number: number };
};

async function pollJob(jobId: string): Promise<void> {
  for (;;) {
    const response = await fetch(`/api/jobs/${jobId}`);
    const body = await response.json();
    const status = body.data?.status;
    if (status === "complete") return;
    if (status === "failed" || status === "cancelled") throw new Error(body.data?.error ?? `Publish job ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

// Distinct from components/tunarr-channel-form.tsx (a Source's own 1:1 Tunarr channel) -- this
// publishes a curated, overlay-rendered Channel as its own, separate Tunarr channel.
export function ChannelTunarrPublishForm({ channelId }: { channelId: string }) {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshStatus() {
    try {
      const response = await fetch(`/api/channels/${channelId}/publish`);
      const body = await response.json();
      if (response.ok) setStatus(body.data);
    } catch { /* best-effort */ }
  }

  useEffect(() => { refreshStatus(); }, [channelId]);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/channels/${channelId}/publish`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not queue the publish job.");
      await pollJob(body.data.jobId);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      await fetch(`/api/channels/${channelId}/publish`, { method: "DELETE" });
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card integration-card">
      <div className="integration-heading"><Radio size={20} /><h2>Tunarr</h2></div>
      {status?.linked ? (
        <p>
          Linked to Tunarr channel <strong>{status.channel?.name ?? status.channelFound ? "" : "(missing on Tunarr)"}</strong>
          {status.channel ? ` (#${status.channel.number})` : ""}.
        </p>
      ) : (
        <p>Not published yet. Every media item must be rendered with this channel&rsquo;s template first.</p>
      )}
      {error ? <p className="error">{error}</p> : null}
      <div className="toolbar">
        <button className="button" type="button" onClick={publish} disabled={busy}>{busy ? "Publishing…" : status?.linked ? "Republish" : "Publish to Tunarr"}</button>
        {status?.linked ? <button className="button secondary" type="button" onClick={unlink} disabled={busy}>Unlink</button> : null}
      </div>
    </div>
  );
}
