"use client";

import { useState } from "react";

// AI Programming Director's preview shape -- mirrors lib/programming/director.ts's DirectorPreview.
// Only the fields this UI reads are typed here; the server is the source of truth for the rest.
export type DirectorPreviewItem = { id: string; title: string; durationSeconds: number };
export type DirectorPreviewBlock = { label: string; startMinutes: number; endMinutes: number; items: DirectorPreviewItem[] };
export type DirectorPreviewGroup = { label: string; weight: number; cooldownMinutes: number; items: DirectorPreviewItem[] };
export type DirectorPreview = {
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

const SERIES_COUNT = 8; // matches the --director-series-N tokens defined in app/globals.css
function seriesColor(index: number) {
  return `var(--director-series-${(index % SERIES_COUNT) + 1})`;
}

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

// Chip list for one block/group's clips -- a wrapped, scrollable set of pills instead of one
// comma-joined run-on paragraph. Collapsed to the first few titles for anything long.
const CLIP_PREVIEW_COUNT = 6;
function ClipChips({ items }: { items: DirectorPreviewItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, CLIP_PREVIEW_COUNT);
  const hidden = items.length - visible.length;
  return (
    <div className="director-clip-list">
      {visible.map((item) => <span key={item.id} className="director-clip-chip" title={`${item.title} (${formatDuration(item.durationSeconds)})`}>{item.title}</span>)}
      {hidden > 0 ? <button type="button" className="director-clip-more" onClick={() => setExpanded(true)}>+{hidden} more</button> : null}
    </div>
  );
}

// Tunarr-guide-style timeline for a dayparts plan: one horizontal track spanning the full day/week,
// a colored segment per block sized to its actual (item-duration-derived) span, and a dashed segment
// for any gap -- the same "loops the last clip until the next block" behavior director.ts already warns
// about, made visible instead of just described in prose.
function DaypartsTimeline({ period, blocks }: { period: "day" | "week"; blocks: DirectorPreviewBlock[] }) {
  const periodMinutes = period === "week" ? 7 * 24 * 60 : 24 * 60;
  type Segment =
    | { kind: "block"; index: number; block: DirectorPreviewBlock; start: number; end: number }
    | { kind: "gap"; start: number; end: number; loopsLabel: string | null };

  const segments: Segment[] = [];
  let cursor = 0;
  blocks.forEach((block, index) => {
    if (block.startMinutes > cursor) {
      segments.push({ kind: "gap", start: cursor, end: block.startMinutes, loopsLabel: index > 0 ? blocks[index - 1].label : null });
    }
    const end = Math.max(block.endMinutes, block.startMinutes);
    segments.push({ kind: "block", index, block, start: block.startMinutes, end });
    cursor = Math.max(cursor, end);
  });
  if (cursor < periodMinutes) {
    segments.push({ kind: "gap", start: cursor, end: periodMinutes, loopsLabel: blocks.length ? blocks[blocks.length - 1].label : null });
  }

  const tickCount = period === "week" ? 7 : 8;
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => Math.round((index * periodMinutes) / tickCount));

  return (
    <div className="director-timeline">
      <div className="director-track">
        {segments.map((segment, index) => {
          const widthPercent = ((segment.end - segment.start) / periodMinutes) * 100;
          if (segment.kind === "gap") {
            return (
              <div
                key={`gap-${index}`}
                className="director-segment director-gap"
                style={{ width: `${widthPercent}%` }}
                title={segment.loopsLabel ? `No block scheduled here -- Tunarr loops "${segment.loopsLabel}"'s last clip until the next block starts.` : "No block scheduled here."}
              />
            );
          }
          return (
            <div
              key={segment.block.label}
              className="director-segment"
              style={{ width: `${widthPercent}%`, background: seriesColor(segment.index) }}
              title={`${segment.block.label}: ${formatClock(period, segment.start)} – ${formatClock(period, segment.end)}`}
            />
          );
        })}
      </div>
      <div className="director-ruler">
        {ticks.map((minute, index) => <span key={index}>{formatClock(period, minute)}</span>)}
      </div>
    </div>
  );
}

// Rotation plans have no explicit timing (Tunarr shuffles within each weighted group, respecting its
// cooldown) -- so instead of a time-based track, this shows each group's approximate share of airtime
// as a proportional composition bar, colored to match its legend row below.
function RotationComposition({ groups }: { groups: DirectorPreviewGroup[] }) {
  const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0) || 1;
  return (
    <div className="director-timeline">
      <div className="director-track">
        {groups.map((group, index) => (
          <div
            key={group.label}
            className="director-segment"
            style={{ width: `${(group.weight / totalWeight) * 100}%`, background: seriesColor(index) }}
            title={`${group.label}: ~${Math.round((group.weight / totalWeight) * 100)}% of rotation (weight ${group.weight})`}
          />
        ))}
      </div>
      <p className="meta director-composition-caption">Approximate share of airtime by weight -- Tunarr actually shuffles play order within each group, respecting its cooldown.</p>
    </div>
  );
}

export function DirectorSchedulePreview({ preview }: { preview: DirectorPreview }) {
  return (
    <>
      {preview.blocks ? <>
        <DaypartsTimeline period={preview.period} blocks={preview.blocks} />
        <div className="director-legend">
          {preview.blocks.map((block, index) => (
            <div key={block.label} className="director-legend-item">
              <span className="director-swatch" style={{ background: seriesColor(index) }} />
              <div>
                <div className="director-legend-head">
                  <strong>{block.label}</strong>
                  <span className="meta">
                    {formatClock(preview.period, block.startMinutes)} – {formatClock(preview.period, block.endMinutes)}
                    {" · "}{formatDuration(block.items.reduce((sum, item) => sum + item.durationSeconds, 0))}
                    {" · "}{block.items.length} clip{block.items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ClipChips items={block.items} />
              </div>
            </div>
          ))}
        </div>
      </> : null}
      {preview.groups ? <>
        <RotationComposition groups={preview.groups} />
        <div className="director-legend">
          {preview.groups.map((group, index) => (
            <div key={group.label} className="director-legend-item">
              <span className="director-swatch" style={{ background: seriesColor(index) }} />
              <div>
                <div className="director-legend-head">
                  <strong>{group.label}</strong>
                  <span className="meta">
                    weight {group.weight}{" · "}cooldown {group.cooldownMinutes}m{" · "}{group.items.length} clip{group.items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ClipChips items={group.items} />
              </div>
            </div>
          ))}
        </div>
      </> : null}
    </>
  );
}
