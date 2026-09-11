"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Radio, Sparkles } from "lucide-react";
import { DEFAULT_SCHEDULE_STYLE, SCHEDULE_STYLE_OPTIONS, type ConceptPreset } from "@/components/ai-programming-presets";
import { ConceptPresetPicker } from "@/components/concept-preset-picker";

// AI Programming Director's preview shape -- mirrors lib/programming/director.ts's DirectorPreview.
// Only the fields this UI reads are typed here; the server is the source of truth for the rest.
type DirectorPreviewItem = { id: string; title: string; durationSeconds: number };
type DirectorPreviewBlock = { label: string; startMinutes: number; endMinutes: number; items: DirectorPreviewItem[] };
type DirectorPreviewGroup = { label: string; weight: number; cooldownMinutes: number; items: DirectorPreviewItem[] };
type DirectorPreview = {
  provider: string;
  kind: "dayparts" | "rotation";
  period: "day" | "week";
  blocks: DirectorPreviewBlock[] | null;
  groups: DirectorPreviewGroup[] | null;
  totalCandidateCount: number;
  usedCandidateCount: number;
  unusedCandidateCount: number;
  warnings: string[];
};

function formatClock(period: "day" | "week", minutes: number) {
  const dayMinutes = 24 * 60;
  const wrapped = ((minutes % dayMinutes) + dayMinutes) % dayMinutes;
  const clock = `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
  if (period === "day") return clock;
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return `${days[Math.floor(minutes / dayMinutes) % 7]} ${clock}`;
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

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
  const [directorPreview, setDirectorPreview] = useState<DirectorPreview | null>(null);
  const [directorBusy, setDirectorBusy] = useState(false);
  const [directorError, setDirectorError] = useState<string | null>(null);
  const isAi = order === "ai";

  function selectPreset(index: number, preset: ConceptPreset) {
    setConceptPreset(index);
    setAiInstructions(preset.instructions);
    if (preset.recommendedScheduleStyle) setAiScheduleStyle(preset.recommendedScheduleStyle);
  }

  // A previewed schedule reflects one specific (instructions, scheduleStyle, provider) combination --
  // discard it the moment any of those change so the preview panel never shows a plan that no longer
  // matches what's in the form.
  useEffect(() => { setDirectorPreview(null); setDirectorError(null); }, [aiInstructions, aiScheduleStyle, aiProvider]);

  // AI Programming Director "Preview" -- asks the configured AI provider (whichever one is selected
  // above, including the local Claude Code CLI) for a schedule and shows it read-only. Nothing is saved
  // or sent to Tunarr until the user clicks "Apply Schedule" below.
  async function previewSchedule() {
    setDirectorBusy(true);
    setDirectorError(null);
    try {
      const response = await fetch(`/api/channels/${channelId}/ai-director/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: aiInstructions.trim(), scheduleStyle: aiScheduleStyle, aiProvider: aiProvider || null })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not generate a schedule preview.");
      setDirectorPreview(body.data);
    } catch (err) {
      setDirectorError(err instanceof Error ? err.message : String(err));
    } finally {
      setDirectorBusy(false);
    }
  }

  // "Apply Schedule" deliberately does nothing new: it saves the same
  // programmingOrder/aiScheduleStyle/aiProgrammingInstructions/aiProvider fields the manual AI
  // Programming panel above already writes, then queues the exact same channel_publish job the regular
  // "Publish to Tunarr" button uses (see publish() below) -- so an AI-directed schedule reaches Tunarr
  // through the same, already-tested path as any other AI-scheduled channel. TunarrTube's own
  // ensureProgrammingPlan (lib/programming/ai-service.ts) will very likely produce the same plan just
  // previewed (same instructions/candidates/provider), but the AI is asked again rather than the
  // previewed plan being persisted directly -- Claude never gets a path to write straight into the
  // lineup; only this normal publish flow does.
  async function applyDirectorSchedule() {
    await publish();
    setDirectorPreview(null);
  }

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
    <section className="card channel-panel channel-tunarr-card">
      <div className="channel-panel-heading">
        <span className="channel-panel-icon"><Radio size={18} /></span>
        <div>
          <h2>Tunarr</h2>
          {status?.linked ? (
            <p>
              Linked to Tunarr channel <strong>{status.channel?.name ?? status.channelFound ? "" : "(missing on Tunarr)"}</strong>
              {status.channel ? ` (#${status.channel.number})` : ""}.
            </p>
          ) : (
            <p>Not published yet. Every media item must be rendered with this channel&rsquo;s template first.</p>
          )}
        </div>
      </div>
      <div className="form-grid">
        <div className="field"><label htmlFor="channel-programming-order">Programming order</label><select className="input" id="channel-programming-order" value={order} onChange={(event) => setOrder(event.target.value)}><option value="manual">Manual order</option><option value="random">Random</option><option value="ai">AI Programming</option></select></div>
      </div>
      {isAi ? <>
        <div className="form-grid">
          <div className="field"><label htmlFor="channel-schedule-style">Schedule style</label><select className="input" id="channel-schedule-style" value={aiScheduleStyle} onChange={(event) => setAiScheduleStyle(event.target.value)}>{SCHEDULE_STYLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="meta">{SCHEDULE_STYLE_OPTIONS.find((option) => option.value === aiScheduleStyle)?.description}</span></div>
          <div className="field"><label htmlFor="channel-ai-provider">AI provider</label><select className="input" id="channel-ai-provider" value={aiProvider} onChange={(event) => setAiProvider(event.target.value)}><option value="">Use global default (Settings)</option><option value="anthropic">Anthropic (Claude)</option><option value="openai">OpenAI</option><option value="claude-code">Claude Code (Local)</option></select></div>
        </div>
        <div className="field"><label htmlFor="channel-concept-preset">Channel style template</label><ConceptPresetPicker idPrefix="channel" selectedIndex={conceptPreset} onSelect={selectPreset} /></div>
        <div className="field"><label htmlFor="channel-ai-instructions">Instructions for the AI (optional)</label><textarea className="input" id="channel-ai-instructions" rows={3} maxLength={4000} placeholder="e.g. Program this channel from 18:00 until midnight in 30-minute blocks, playing episodes in order." value={aiInstructions} onChange={(event) => setAiInstructions(event.target.value)} /></div>

        <div className="card" style={{ marginTop: 8 }}>
          <div className="integration-heading"><Sparkles size={18} /><h3 style={{ margin: 0 }}>AI Programming Director</h3></div>
          <p className="meta">Describe the schedule you want in plain language, preview exactly what the AI proposes, then apply it — nothing is saved or sent to Tunarr until you click Apply. A channel with many items can take a few minutes to preview, especially with the local Claude Code provider — this page waits for the response, so avoid navigating away mid-preview.</p>
          <div className="toolbar">
            <button className="button secondary" type="button" onClick={previewSchedule} disabled={directorBusy || busy || !aiInstructions.trim()}>{directorBusy && <LoaderCircle size={14} className="animate-spin" />} Preview Schedule</button>
          </div>
          {directorError ? <p className="error">{directorError}</p> : null}
          {directorPreview ? <div className="director-preview">
            <p>
              <strong>{directorPreview.provider}</strong> proposed a {directorPreview.kind === "dayparts" ? `${directorPreview.period === "week" ? "weekly" : "daily"} dayparts` : "rotation"} schedule
              using {directorPreview.usedCandidateCount} of {directorPreview.totalCandidateCount} available clip{directorPreview.totalCandidateCount === 1 ? "" : "s"}.
            </p>
            {directorPreview.warnings.map((warning, index) => <p key={index} className="error">{warning}</p>)}
            {directorPreview.blocks ? directorPreview.blocks.map((block) => (
              <div key={block.label} className="system-row">
                <strong>{block.label}</strong>
                <div className="meta">{formatClock(directorPreview.period, block.startMinutes)} – {formatClock(directorPreview.period, block.endMinutes)} · {formatDuration(block.items.reduce((sum, item) => sum + item.durationSeconds, 0))} · {block.items.length} clip{block.items.length === 1 ? "" : "s"}</div>
                <div className="meta">{block.items.map((item) => item.title).join(", ")}</div>
              </div>
            )) : null}
            {directorPreview.groups ? directorPreview.groups.map((group) => (
              <div key={group.label} className="system-row">
                <strong>{group.label}</strong>
                <div className="meta">weight {group.weight} · cooldown {group.cooldownMinutes}m · {group.items.length} clip{group.items.length === 1 ? "" : "s"}</div>
                <div className="meta">{group.items.map((item) => item.title).join(", ")}</div>
              </div>
            )) : null}
            <div className="toolbar">
              <button className="button" type="button" onClick={applyDirectorSchedule} disabled={busy || directorBusy}>{busy ? "Applying…" : "Apply Schedule"}</button>
              <button className="button secondary" type="button" onClick={previewSchedule} disabled={directorBusy || busy}>Regenerate</button>
              <button className="button secondary" type="button" onClick={() => setDirectorPreview(null)} disabled={directorBusy || busy}>Cancel</button>
            </div>
          </div> : null}
        </div>
      </> : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="toolbar">
        <button className="button" type="button" onClick={publish} disabled={busy}>{busy ? "Publishing…" : status?.linked ? "Republish" : "Publish to Tunarr"}</button>
        {status?.linked ? <button className="button secondary" type="button" onClick={unlink} disabled={busy}>Unlink</button> : null}
      </div>
    </section>
  );
}
