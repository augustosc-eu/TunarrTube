"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ListFilter, Sparkles } from "lucide-react";

type SourceOption = { id: string; name: string };
type Method = "ai" | "heuristic";
type HeuristicMode = "balanced" | "grouped";

async function pollJob(jobId: string): Promise<void> {
  for (;;) {
    const response = await fetch(`/api/jobs/${jobId}`);
    const body = await response.json();
    const status = body.data?.status;
    if (status === "complete") return;
    if (status === "failed" || status === "cancelled") throw new Error(body.data?.error ?? `Selection job ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

// Content selection (lib/channels/service.ts): given one or more existing Sources, picks which of their
// already-downloaded videos belong on this channel, then attaches the ones picked -- a curation
// shortcut alongside (not a replacement for) AddChannelItemsForm's manual add-by-hand flow. Two
// interchangeable methods share this one card/job: "AI" (lib/programming/content-selection.ts, needs a
// free-text brief) and "Smart" (lib/programming/heuristic-selection.ts, deterministic, no AI provider
// required -- scores by freshness/novelty/duration fit and orders by source or artist/show grouping).
export function AiContentSelectForm({ channelId }: { channelId: string }) {
  const router = useRouter();
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [method, setMethod] = useState<Method>("ai");
  const [instructions, setInstructions] = useState("");
  const [heuristicMode, setHeuristicMode] = useState<HeuristicMode>("balanced");
  const [targetCount, setTargetCount] = useState("");
  const [targetDurationMinutes, setTargetDurationMinutes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/sources").then((response) => response.json()).then((body) => {
      if (Array.isArray(body.data)) setSources(body.data.map((source: SourceOption) => ({ id: source.id, name: source.name })));
    }).catch(() => { /* best-effort */ });
  }, []);

  function toggleSource(id: string) {
    setSelectedSourceIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function submit() {
    setBusy(true); setFailed(false);
    setMessage(method === "ai" ? "Asking the AI provider which clips fit…" : "Scoring and picking clips…");
    try {
      const response = await fetch(`/api/channels/${channelId}/content-select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceIds: selectedSourceIds, method,
          instructions: method === "ai" ? instructions.trim() : undefined,
          targetCount: targetCount ? Number(targetCount) : undefined,
          mode: method === "heuristic" ? heuristicMode : undefined,
          targetDurationSeconds: method === "heuristic" && targetDurationMinutes ? Number(targetDurationMinutes) * 60 : undefined
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not queue content selection.");
      await pollJob(body.data.jobId);
      setMessage("Selection complete.");
      router.refresh();
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : "Content selection failed");
    } finally { setBusy(false); }
  }

  if (!sources.length) return null;

  const canSubmit = selectedSourceIds.length > 0 && (method === "heuristic" || instructions.trim().length > 0);

  return (
    <section className="card channel-panel ai-selection-panel">
      <div className="channel-panel-heading">
        <div className="channel-panel-icon">{method === "ai" ? <Sparkles size={18} /> : <ListFilter size={18} />}</div>
        <div>
          <h2>Content selection</h2>
          <p>Choose source libraries and let TunarrTube pick which of their downloaded videos belong on this channel.</p>
        </div>
      </div>
      <div className="field">
        <label>Method</label>
        <div className="toolbar" role="tablist" aria-label="Selection method">
          <button type="button" className={`button ${method === "ai" ? "" : "secondary"}`} aria-pressed={method === "ai"} onClick={() => setMethod("ai")}><Sparkles size={14} /> AI</button>
          <button type="button" className={`button ${method === "heuristic" ? "" : "secondary"}`} aria-pressed={method === "heuristic"} onClick={() => setMethod("heuristic")}><ListFilter size={14} /> Smart (no AI)</button>
        </div>
      </div>
      <div className="field">
        <label>Sources to choose from</label>
        <div className="source-picker-grid">
          {sources.map((source) => (
            <label key={source.id} className="source-picker-option" title={source.name}>
              <input type="checkbox" checked={selectedSourceIds.includes(source.id)} onChange={() => toggleSource(source.id)} />
              <span>{source.name}</span>
            </label>
          ))}
        </div>
      </div>
      {method === "ai" ? (
        <div className="ai-brief-grid">
          <div className="field">
            <label htmlFor="content-select-instructions">Brief</label>
            <textarea className="input" id="content-select-instructions" rows={3} maxLength={4000} placeholder="e.g. only upbeat J-pop, skip anything acoustic" value={instructions} onChange={(event) => setInstructions(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="content-select-target">Target count (optional)</label>
            <input className="input" id="content-select-target" type="number" min="1" placeholder="AI's judgment" value={targetCount} onChange={(event) => setTargetCount(event.target.value)} />
          </div>
        </div>
      ) : (
        <div className="ai-brief-grid">
          <div className="field">
            <label htmlFor="content-select-mode">Style</label>
            <select className="input" id="content-select-mode" value={heuristicMode} onChange={(event) => setHeuristicMode(event.target.value as HeuristicMode)}>
              <option value="balanced">Balanced mix — freshest, least-recently-used, spread across sources</option>
              <option value="grouped">Grouped by show or artist — marathon blocks, oldest to newest</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="content-select-target">Target count (optional)</label>
            <input className="input" id="content-select-target" type="number" min="1" placeholder="Up to 100" value={targetCount} onChange={(event) => setTargetCount(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="content-select-duration">Target clip length in minutes (optional)</label>
            <input className="input" id="content-select-duration" type="number" min="1" placeholder="No preference" value={targetDurationMinutes} onChange={(event) => setTargetDurationMinutes(event.target.value)} />
          </div>
        </div>
      )}
      <button className="button ai-selection-action" type="button" disabled={busy || !canSubmit} onClick={submit}>
        {method === "ai" ? <Sparkles size={16} /> : <ListFilter size={16} />} {busy ? "Selecting…" : "Suggest content"}
      </button>
      {message ? <p className={failed ? "error" : "success"}>{message}</p> : null}
    </section>
  );
}
