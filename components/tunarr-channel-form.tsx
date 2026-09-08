"use client";

import { useState } from "react";
import { Clapperboard, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { CONCEPT_PRESETS, DEFAULT_SCHEDULE_STYLE, SCHEDULE_STYLE_OPTIONS } from "@/components/ai-programming-presets";

type Props = {
  sourceId: string;
  sourceName: string;
  downloadedCount: number;
  playbackMode: string;
  channelId: string | null;
  channelNumber: number | null;
  lastPublishedLabel: string | null;
  initialChannelName: string | null;
  initialOrder: string;
  initialAiInstructions: string | null;
  initialAiProvider: string | null;
  initialAiScheduleStyle: string | null;
};

async function responseData(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body.data;
}

export function TunarrChannelForm({ sourceId, sourceName, downloadedCount, playbackMode, channelId, channelNumber, lastPublishedLabel, initialChannelName, initialOrder, initialAiInstructions, initialAiProvider, initialAiScheduleStyle }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialChannelName ?? sourceName);
  const [number, setNumber] = useState(channelNumber?.toString() ?? "");
  const [order, setOrder] = useState(initialOrder);
  const [aiInstructions, setAiInstructions] = useState(initialAiInstructions ?? "");
  const [aiProvider, setAiProvider] = useState(initialAiProvider ?? "");
  const [aiScheduleStyle, setAiScheduleStyle] = useState(initialAiScheduleStyle ?? DEFAULT_SCHEDULE_STYLE);
  const [conceptPreset, setConceptPreset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [candidates, setCandidates] = useState<Array<{ id: string; name: string; number: number }>>([]);
  const [channelChoice, setChannelChoice] = useState("");
  const isLinked = Boolean(channelId);
  const isAi = order === "ai";

  async function publish() {
    setBusy(true); setFailed(false); setMessage(isAi ? "Asking the AI provider for a schedule…" : "Preparing Tunarr local media…");
    try {
      const job = await responseData(await fetch(`/api/sources/${sourceId}/tunarr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelName: name, channelNumber: number ? Number(number) : undefined, programmingOrder: order,
          ...(isAi ? { aiInstructions: aiInstructions.trim() || null, aiProvider: aiProvider || null, aiScheduleStyle } : {})
        })
      }));
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const current = await responseData(await fetch(`/api/jobs/${job.id}`, { cache: "no-store" }));
        if (["complete", "failed", "cancelled"].includes(current.status)) {
          if (current.status !== "complete") throw new Error(current.error ?? "Tunarr publish failed");
          setMessage(isLinked ? "Tunarr channel updated." : "Tunarr channel created.");
          break;
        }
        setMessage("Tunarr is scanning media and building the channel…");
      }
      router.refresh();
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : "Tunarr publish failed");
    } finally { setBusy(false); }
  }

  async function reconcile() { setBusy(true); setFailed(false); try { const status = await responseData(await fetch(`/api/sources/${sourceId}/tunarr/reconcile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(channelChoice ? { channelId: channelChoice } : {}) })); setCandidates(status.channelFound ? [] : status.candidates); setMessage(status.channelFound ? "Tunarr link reconciled." : "Stored channel was not found. Select an existing channel or republish."); router.refresh(); } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Reconciliation failed"); } finally { setBusy(false); } }
  async function unlink() { if (!window.confirm("Forget this Tunarr link? The remote channel will not be deleted.")) return; setBusy(true); try { await responseData(await fetch(`/api/sources/${sourceId}/tunarr`, { method: "DELETE" })); setMessage("Tunarr link removed; remote objects were preserved."); router.refresh(); } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Unlink failed"); } finally { setBusy(false); } }

  return <section className="card integration-card">
    <div className="integration-heading"><div><span className="eyebrow">Tunarr integration</span><h2>{isLinked ? "Update channel" : "Create channel"}</h2></div><Clapperboard size={24} /></div>
    <p>TunarrTube registers this source directory as Tunarr Local Media. Cache and Stream sources are fully prefetched on their first publication.</p>
    <div className="form-grid">
      <div className="field"><label htmlFor="tunarr-channel-name">Channel name</label><input className="input" id="tunarr-channel-name" value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /></div>
      <div className="field"><label htmlFor="tunarr-channel-number">Channel number</label><input className="input" id="tunarr-channel-number" type="number" min="1" placeholder="Next available" value={number} onChange={(event) => setNumber(event.target.value)} /></div>
      <div className="field"><label htmlFor="tunarr-programming-order">Programming order</label><select className="input" id="tunarr-programming-order" value={order} onChange={(event) => setOrder(event.target.value)}><option value="playlist">Playlist order</option><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="random">Random</option><option value="ai">AI Programming</option></select></div>
    </div>
    {isAi ? <div className="form-grid">
      <div className="field"><label htmlFor="tunarr-schedule-style">Schedule style</label><select className="input" id="tunarr-schedule-style" value={aiScheduleStyle} onChange={(event) => setAiScheduleStyle(event.target.value)}>{SCHEDULE_STYLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="meta">{SCHEDULE_STYLE_OPTIONS.find((option) => option.value === aiScheduleStyle)?.description}</span></div>
      <div className="field"><label htmlFor="tunarr-concept-preset">Concept preset</label><select className="input" id="tunarr-concept-preset" value={conceptPreset} onChange={(event) => { const index = Number(event.target.value); setConceptPreset(index); setAiInstructions(CONCEPT_PRESETS[index].instructions); }}>{CONCEPT_PRESETS.map((preset, index) => <option key={preset.label} value={index}>{preset.label}</option>)}</select><span className="meta">Fills the instructions below -- edit freely after picking one.</span></div>
      <div className="field"><label htmlFor="tunarr-ai-instructions">Instructions for the AI (optional)</label><textarea className="input" id="tunarr-ai-instructions" rows={3} maxLength={4000} placeholder="e.g. mornings should be calmer clips, evenings more upbeat" value={aiInstructions} onChange={(event) => setAiInstructions(event.target.value)} /></div>
      <div className="field"><label htmlFor="tunarr-ai-provider">AI provider</label><select className="input" id="tunarr-ai-provider" value={aiProvider} onChange={(event) => setAiProvider(event.target.value)}><option value="">Use global default (Settings)</option><option value="anthropic">Anthropic (Claude)</option><option value="openai">OpenAI</option></select></div>
    </div> : null}
    <div className="toolbar"><button className="button" disabled={busy || (playbackMode === "download" && downloadedCount === 0) || !name.trim()} onClick={publish}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Clapperboard size={15} />} {isLinked ? "Update Tunarr Channel" : "Create Tunarr Channel"}</button>{isLinked ? <><button className="button secondary" disabled={busy} onClick={reconcile}>Reconcile</button><button className="button secondary" disabled={busy} onClick={unlink}>Unlink</button></> : null}<span className="muted">{downloadedCount} local video{downloadedCount === 1 ? "" : "s"} ready</span></div>
    {playbackMode === "download" && downloadedCount === 0 ? <div className="error">Wait for or download at least one video before creating a channel.</div> : null}
    {message && <p className={failed ? "error" : "success"}>{message}</p>}
    {candidates.length ? <div className="toolbar"><select className="input" aria-label="Existing Tunarr channel" value={channelChoice} onChange={(event) => setChannelChoice(event.target.value)}><option value="">Choose an existing channel</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.number} · {candidate.name}</option>)}</select><button className="button secondary" disabled={!channelChoice || busy} onClick={reconcile}>Relink selected</button></div> : null}
    {isLinked && <div className="meta"><span>Channel {channelNumber ?? "—"}</span><span>·</span><span className="code">{channelId}</span><span>·</span><span>Published {lastPublishedLabel}</span></div>}
  </section>;
}
