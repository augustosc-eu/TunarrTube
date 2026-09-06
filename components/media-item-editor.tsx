"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Search, Wand2 } from "lucide-react";
import { TemplatePreviewFrame } from "@/components/template-preview-frame";
import type { MetadataCandidate } from "@/lib/metadata-lookup/types";
import type { BindingField } from "@/lib/overlay/types";

type MediaItem = {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  year: number | null;
  genre: string | null;
  customFieldsJson: string | null;
};

type Template = { id: string; name: string; htmlTemplate: string; bindingsJson: string };
type RenderInfo = { status: string; error: string | null } | null;

// Bindings the built-in title/artist/album inputs already cover -- everything else the template
// declares gets its own free-text input in the "Custom overlay fields" section.
const BUILT_IN_BINDING_KEYS = new Set(["title", "artist", "album"]);

// Mirrors BUILT_IN_FIELD_ALIASES in lib/overlay/service.ts (duplicated here because that module
// pulls in server-only fs imports) -- keeps this live preview's fallback order consistent with
// what resolveBindingValues will actually use for a real render.
const BUILT_IN_ALIASES: Record<string, "title" | "artist" | "album" | "genre" | "year"> = {
  title: "title",
  headline: "title",
  artist: "artist",
  byline: "artist",
  album: "album",
  genre: "genre",
  category: "genre",
  year: "year"
};

function parseCustomFields(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function MediaItemEditor({ channelId: _channelId, mediaItem, template, render }: { channelId: string; mediaItem: MediaItem; template: Template; render: RenderInfo }) {
  const router = useRouter();
  const [title, setTitle] = useState(mediaItem.title);
  const [artist, setArtist] = useState(mediaItem.artist ?? "");
  const [album, setAlbum] = useState(mediaItem.album ?? "");
  const [customFields, setCustomFields] = useState<Record<string, string>>(() => parseCustomFields(mediaItem.customFieldsJson));
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [candidates, setCandidates] = useState<MetadataCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);

  const bindings = useMemo<BindingField[]>(() => {
    try { return JSON.parse(template.bindingsJson); } catch { return []; }
  }, [template.bindingsJson]);
  const customBindings = useMemo(() => bindings.filter((field) => !BUILT_IN_BINDING_KEYS.has(field.key)), [bindings]);

  const previewValues = useMemo(() => {
    const builtInState: Partial<Record<"title" | "artist" | "album" | "genre" | "year", string>> = {
      title, artist, album,
      genre: mediaItem.genre ?? "",
      year: mediaItem.year != null ? String(mediaItem.year) : ""
    };
    return Object.fromEntries(bindings.map((field) => {
      const custom = customFields[field.key];
      if (custom) return [field.key, custom];
      const alias = BUILT_IN_ALIASES[field.key];
      // An aliased key (title/artist/album/genre/year, or a template's alias like "headline")
      // always resolves to real metadata or "" -- never sample placeholder text, matching
      // resolveBindingValues in lib/overlay/service.ts exactly.
      if (alias) return [field.key, builtInState[alias] ?? ""];
      return [field.key, field.sampleValue];
    }));
  }, [bindings, customFields, title, artist, album, mediaItem.genre, mediaItem.year]);

  function setCustomField(key: string, value: string) {
    setCustomFields((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/media-items/${mediaItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, artist: artist || null, album: album || null, customFieldsJson: JSON.stringify(customFields) })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not save metadata.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function search() {
    setSearching(true);
    setError(null);
    try {
      const query = new URLSearchParams({ title, artist });
      const response = await fetch(`/api/media-items/${mediaItem.id}/metadata-search?${query}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Metadata search failed.");
      setCandidates(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function apply(candidate: MetadataCandidate) {
    setError(null);
    try {
      const response = await fetch(`/api/media-items/${mediaItem.id}/metadata-apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(candidate)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not apply metadata.");
      setTitle(body.data.title);
      setArtist(body.data.artist ?? "");
      setAlbum(body.data.album ?? "");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function renderNow() {
    setRendering(true);
    setError(null);
    try {
      const response = await fetch(`/api/media-items/${mediaItem.id}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not queue render.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="card form-card">
        <TemplatePreviewFrame htmlTemplate={template.htmlTemplate} values={previewValues} />

        <div className="form-grid" style={{ marginTop: 22 }}>
          <div className="field"><label>Title</label><input className="input" value={title} onChange={(event) => setTitle(event.target.value)} /></div>
          <div className="field"><label>Artist</label><input className="input" value={artist} onChange={(event) => setArtist(event.target.value)} /></div>
          <div className="field"><label>Album</label><input className="input" value={album} onChange={(event) => setAlbum(event.target.value)} /></div>
        </div>

        {customBindings.length ? (
          <div style={{ marginTop: 18 }}>
            <p className="muted" style={{ marginBottom: 8 }}>Custom overlay fields — &quot;{template.name}&quot; also uses these; leave blank to fall back to the template&apos;s sample text.</p>
            <div className="form-grid">
              {customBindings.map((field) => (
                <div className="field" key={field.key}>
                  <label>{field.label}</label>
                  <input className="input" value={customFields[field.key] ?? ""} onChange={(event) => setCustomField(field.key, event.target.value)} placeholder={field.sampleValue} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
        <div className="toolbar">
          <button className="button" type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save metadata"}</button>
          <button className="button secondary" type="button" onClick={search} disabled={searching}><Search size={15} /> {searching ? "Searching…" : "Look up (MusicBrainz / iTunes)"}</button>
          <span className="spacer" />
          <button className="button" type="button" onClick={renderNow} disabled={rendering}><Wand2 size={15} /> {rendering ? "Queuing…" : "Render overlay"}</button>
        </div>
        {render ? <p className="muted">Render status: <span className={`badge ${render.status}`}>{render.status}</span>{render.error ? ` — ${render.error}` : ""}</p> : null}

        {candidates.length ? (
          <div className="choices" style={{ marginTop: 12 }}>
            {candidates.map((candidate) => (
              <div className="choice" key={`${candidate.provider}-${candidate.externalId}`}>
                <span>
                  <span className="badge">{candidate.provider}</span>
                  {candidate.title} — {candidate.artist ?? "unknown artist"}{candidate.album ? ` (${candidate.album})` : ""}
                </span>
                <button className="button secondary" type="button" onClick={() => apply(candidate)}>Apply</button>
              </div>
            ))}
          </div>
        ) : null}
    </div>
  );
}
