"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SCHEDULE_STYLE_OPTIONS, DEFAULT_SCHEDULE_STYLE } from "@/components/ai-programming-presets";

type Template = { id: string; name: string; channelType: string; isBuiltIn: boolean };
type SourceOption = { id: string; name: string };

// One-shot channel creation: give a brief instead of manually adding media, rendering, and
// publishing step by step. Queues a single channel_brief job (lib/channels/service.ts:runChannelBrief)
// that does AI content selection (from the chosen Sources' already-downloaded videos only -- this
// flow never downloads anything new), renders every selected clip, and publishes with AI programming
// using the same brief text as its instructions.
export function ChannelBriefForm({ templates, sources }: { templates: Template[]; sources: SourceOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [brief, setBrief] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [scheduleStyle, setScheduleStyle] = useState<string>(DEFAULT_SCHEDULE_STYLE);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleSource(id: string) {
    setSelectedSourceIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/channels/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, templateId, brief: brief.trim(), sourceIds: selectedSourceIds, scheduleStyle })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not start building this channel.");
      router.push(`/channels/${body.data.channelId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  if (!sources.length) {
    return <p className="muted">You need at least one Source with downloaded videos before you can build a channel from a brief -- add a Source first.</p>;
  }

  return (
    <form className="card form-card" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="brief-channel-name">Channel name</label>
        <input id="brief-channel-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. J-Pop Video Rotation" required />
      </div>
      <div className="field">
        <label htmlFor="brief-channel-template">Overlay template</label>
        <select id="brief-channel-template" className="input" value={templateId} onChange={(event) => setTemplateId(event.target.value)} required>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>{template.name}{template.isBuiltIn ? " (built-in)" : ""}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Sources to draw content from</label>
        <div className="form-grid">
          {sources.map((source) => (
            <label key={source.id} className="switch-text" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={selectedSourceIds.includes(source.id)} onChange={() => toggleSource(source.id)} /> {source.name}
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="brief-text">Brief</label>
        <textarea className="input" id="brief-text" rows={4} maxLength={4000} placeholder="e.g. a late-night J-pop rotation, calmer songs after midnight, upbeat charts in the evening" value={brief} onChange={(event) => setBrief(event.target.value)} required />
        <span className="meta">Used both to pick which videos join the channel and to schedule them once published.</span>
      </div>
      <div className="field">
        <label htmlFor="brief-schedule-style">Schedule style</label>
        <select className="input" id="brief-schedule-style" value={scheduleStyle} onChange={(event) => setScheduleStyle(event.target.value)}>
          {SCHEDULE_STYLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <span className="meta">{SCHEDULE_STYLE_OPTIONS.find((option) => option.value === scheduleStyle)?.description}</span>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <button className="button" type="submit" disabled={submitting || !templateId || !selectedSourceIds.length || !brief.trim()}>
        {submitting ? "Starting…" : "Build this channel"}
      </button>
      <p className="muted">This selects content, renders it, and publishes to Tunarr in the background -- open the channel page or the Queue to watch progress.</p>
    </form>
  );
}
