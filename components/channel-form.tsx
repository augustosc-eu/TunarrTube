"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Template = { id: string; name: string; channelType: string; isBuiltIn: boolean };

export function ChannelForm({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, templateId })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not create the channel.");
      router.push(`/channels/${body.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <form className="card form-card" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="channel-name">Channel name</label>
        <input id="channel-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. J-Pop Video Rotation" required />
      </div>
      <div className="field">
        <label htmlFor="channel-template">Overlay template</label>
        <select id="channel-template" className="input" value={templateId} onChange={(event) => setTemplateId(event.target.value)} required>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>{template.name}{template.isBuiltIn ? " (built-in)" : ""}</option>
          ))}
        </select>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <button className="button" type="submit" disabled={submitting || !templateId}>{submitting ? "Creating…" : "Create channel"}</button>
    </form>
  );
}
