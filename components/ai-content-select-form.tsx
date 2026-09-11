"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

type SourceOption = { id: string; name: string };

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

// AI content selection (lib/programming/content-selection.ts): given one or more existing Sources,
// asks an AI provider which of their already-downloaded videos belong on this channel, then attaches
// the ones it picked -- a curation shortcut alongside (not a replacement for) AddChannelItemsForm's
// manual add-by-hand flow.
export function AiContentSelectForm({ channelId }: { channelId: string }) {
  const router = useRouter();
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const [targetCount, setTargetCount] = useState("");
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
    setBusy(true); setFailed(false); setMessage("Asking the AI provider which clips fit…");
    try {
      const response = await fetch(`/api/channels/${channelId}/content-select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceIds: selectedSourceIds, instructions: instructions.trim(),
          targetCount: targetCount ? Number(targetCount) : undefined
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

  return (
    <section className="card channel-panel ai-selection-panel">
      <div className="channel-panel-heading">
        <div className="channel-panel-icon"><Sparkles size={18} /></div>
        <div>
          <h2>AI content selection</h2>
          <p>Choose source libraries and describe what belongs on this channel. Large libraries may take a few minutes to process.</p>
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
      <button className="button ai-selection-action" type="button" disabled={busy || !selectedSourceIds.length || !instructions.trim()} onClick={submit}>
        <Sparkles size={16} /> {busy ? "Selecting…" : "Suggest content"}
      </button>
      {message ? <p className={failed ? "error" : "success"}>{message}</p> : null}
    </section>
  );
}
