"use client";

import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { CONCEPT_PRESETS, DEFAULT_SCHEDULE_STYLE, SCHEDULE_STYLE_OPTIONS } from "@/components/ai-programming-presets";

type LinkStatus = {
  linked: boolean;
  mediaSourceFound: boolean;
  libraryFound: boolean;
  channelFound: boolean;
  channel?: { name: string; number: number };
};

type Props = {
  channelId: string;
  initialProgrammingOrder: string;
  initialAiInstructions: string | null;
  initialAiProvider: string | null;
  initialAiScheduleStyle: string | null;
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
export function ChannelTunarrPublishForm({ channelId, initialProgrammingOrder, initialAiInstructions, initialAiProvider, initialAiScheduleStyle }: Props) {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState(initialProgrammingOrder);
  const [aiInstructions, setAiInstructions] = useState(initialAiInstructions ?? "");
  const [aiProvider, setAiProvider] = useState(initialAiProvider ?? "");
  const [aiScheduleStyle, setAiScheduleStyle] = useState(initialAiScheduleStyle ?? DEFAULT_SCHEDULE_STYLE);
  const [conceptPreset, setConceptPreset] = useState(0);
  const isAi = order === "ai";

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
      const patchResponse = await fetch(`/api/channels/${channelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programmingOrder: order, ...(isAi ? { aiProgrammingInstructions: aiInstructions.trim() || null, aiProvider: aiProvider || null, aiScheduleStyle } : {}) })
      });
      const patchBody = await patchResponse.json();
      if (!patchResponse.ok) throw new Error(patchBody.error?.message ?? "Could not save the programming order.");
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
      <div className="form-grid">
        <div className="field"><label htmlFor="channel-programming-order">Programming order</label><select className="input" id="channel-programming-order" value={order} onChange={(event) => setOrder(event.target.value)}><option value="manual">Manual order</option><option value="random">Random</option><option value="ai">AI Programming</option></select></div>
      </div>
      {isAi ? <div className="form-grid">
        <div className="field"><label htmlFor="channel-schedule-style">Schedule style</label><select className="input" id="channel-schedule-style" value={aiScheduleStyle} onChange={(event) => setAiScheduleStyle(event.target.value)}>{SCHEDULE_STYLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="meta">{SCHEDULE_STYLE_OPTIONS.find((option) => option.value === aiScheduleStyle)?.description}</span></div>
        <div className="field"><label htmlFor="channel-concept-preset">Concept preset</label><select className="input" id="channel-concept-preset" value={conceptPreset} onChange={(event) => { const index = Number(event.target.value); setConceptPreset(index); setAiInstructions(CONCEPT_PRESETS[index].instructions); }}>{CONCEPT_PRESETS.map((preset, index) => <option key={preset.label} value={index}>{preset.label}</option>)}</select><span className="meta">Fills the instructions below -- edit freely after picking one.</span></div>
        <div className="field"><label htmlFor="channel-ai-instructions">Instructions for the AI (optional)</label><textarea className="input" id="channel-ai-instructions" rows={3} maxLength={4000} placeholder="e.g. group by artist, keep a mellow block in the evening" value={aiInstructions} onChange={(event) => setAiInstructions(event.target.value)} /></div>
        <div className="field"><label htmlFor="channel-ai-provider">AI provider</label><select className="input" id="channel-ai-provider" value={aiProvider} onChange={(event) => setAiProvider(event.target.value)}><option value="">Use global default (Settings)</option><option value="anthropic">Anthropic (Claude)</option><option value="openai">OpenAI</option></select></div>
      </div> : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="toolbar">
        <button className="button" type="button" onClick={publish} disabled={busy}>{busy ? "Publishing…" : status?.linked ? "Republish" : "Publish to Tunarr"}</button>
        {status?.linked ? <button className="button secondary" type="button" onClick={unlink} disabled={busy}>Unlink</button> : null}
      </div>
    </div>
  );
}
