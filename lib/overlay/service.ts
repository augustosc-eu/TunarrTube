import path from "node:path";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { RENDER_CACHE_ROOT } from "@/lib/constants";
import { db } from "@/lib/db/client";
import { fillTemplate } from "@/lib/overlay/bindings";
import { renderHtmlToPng } from "@/lib/overlay/puppeteer";
import { MUSIC_VIDEO_TEMPLATE } from "@/lib/overlay/templates/music-video";
import { NEWS_TEMPLATE } from "@/lib/overlay/templates/news";
import type { BindingField, OverlayLayer } from "@/lib/overlay/types";

const BUILT_IN_TEMPLATES = [MUSIC_VIDEO_TEMPLATE, NEWS_TEMPLATE];

// Self-healing seed, same create-on-first-use convention as getSettings() -- works against any
// fresh DB without a separate seed script/migration data step. Loops so adding another built-in
// template category is just another entry in BUILT_IN_TEMPLATES, no schema change.
export async function ensureBuiltInTemplates() {
  return Promise.all(BUILT_IN_TEMPLATES.map(async (definition) => {
    const existing = await db.overlayTemplate.findFirst({ where: { isBuiltIn: true, channelType: definition.channelType } });
    if (existing) return existing;
    return db.overlayTemplate.create({
      data: {
        name: definition.name,
        channelType: definition.channelType,
        description: definition.description,
        htmlTemplate: definition.html,
        bindingsJson: JSON.stringify(definition.bindings),
        layersJson: JSON.stringify(definition.layers),
        isBuiltIn: true
      }
    });
  }));
}

export function parseBindings(template: { bindingsJson: string }): BindingField[] {
  return JSON.parse(template.bindingsJson);
}

export function parseLayers(template: { layersJson: string }): OverlayLayer[] {
  return JSON.parse(template.layersJson);
}

export function sampleValues(bindings: BindingField[]): Record<string, string> {
  return Object.fromEntries(bindings.map((field) => [field.key, field.sampleValue]));
}

export async function renderOverlayLayers(
  mediaItemId: string,
  template: { id: string; htmlTemplate: string; layersJson: string },
  values: Record<string, string>
): Promise<Array<{ layer: OverlayLayer; pngPath: string }>> {
  const layers = parseLayers(template);
  const outDir = path.join(RENDER_CACHE_ROOT, mediaItemId, template.id);
  await mkdir(outDir, { recursive: true });

  const results: Array<{ layer: OverlayLayer; pngPath: string }> = [];
  for (const layer of layers) {
    const html = fillTemplate(template.htmlTemplate, values);
    const png = await renderHtmlToPng(html, { width: layer.canvasWidth, height: layer.canvasHeight });
    const target = path.join(outDir, `${layer.id}.png`);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, png);
    await rename(temp, target);
    results.push({ layer, pngPath: target });
  }
  return results;
}

export type BindableMediaItem = {
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  customFieldsJson: string | null;
};

// Binding keys that draw a fallback value straight from MediaItem metadata when no per-item custom
// field is set. Aliases (e.g. "headline"/"byline"/"category" on the news template) let a template
// use its own vocabulary while still auto-populating from existing metadata; a key with no alias
// here (e.g. the news template's "ticker") only ever gets a value from customFieldsJson or the
// binding's own sampleValue.
const BUILT_IN_FIELD_ALIASES: Record<string, "title" | "artist" | "album" | "genre" | "year"> = {
  title: "title",
  headline: "title",
  artist: "artist",
  byline: "artist",
  album: "album",
  genre: "genre",
  category: "genre",
  year: "year"
};

function builtInFieldValue(mediaItem: BindableMediaItem, key: string): string | null {
  const field = BUILT_IN_FIELD_ALIASES[key];
  if (!field) return null;
  const value = mediaItem[field];
  return value === null || value === undefined ? null : String(value);
}

export function parseCustomFields(mediaItem: { customFieldsJson: string | null }): Record<string, string> {
  if (!mediaItem.customFieldsJson) return {};
  try {
    const parsed = JSON.parse(mediaItem.customFieldsJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// The single source of truth for a render's live values, in priority order: an explicit per-item
// custom field, then a matching built-in MediaItem column (an existing-but-blank column stays ""
// rather than falling all the way to placeholder copy), then the binding's own sampleValue as a
// last resort for fields with no MediaItem column at all.
export function resolveBindingValues(mediaItem: BindableMediaItem, bindings: BindingField[]): Record<string, string> {
  const customFields = parseCustomFields(mediaItem);
  return Object.fromEntries(bindings.map((field) => {
    const custom = customFields[field.key];
    if (typeof custom === "string" && custom.length > 0) return [field.key, custom];
    const builtIn = builtInFieldValue(mediaItem, field.key);
    if (builtIn !== null) return [field.key, builtIn];
    return [field.key, BUILT_IN_FIELD_ALIASES[field.key] ? "" : field.sampleValue];
  }));
}
