"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Clapperboard, Film, Music, Pencil, Smile, Sparkles, Tv, type LucideIcon } from "lucide-react";
import { CONCEPT_PRESET_CATEGORIES, CONCEPT_PRESETS, type ConceptPreset, type ConceptPresetCategory } from "@/components/ai-programming-presets";

const CATEGORY_ICONS: Record<ConceptPresetCategory, LucideIcon> = {
  Custom: Pencil,
  "Music Video Channels": Music,
  "Broadcast & Variety": Tv,
  "Movie Channels": Film,
  "Comedy & Sitcom": Smile,
  "Mood & Format": Sparkles
};

type Props = {
  idPrefix: string;
  selectedIndex: number;
  onSelect: (index: number, preset: ConceptPreset) => void;
};

// Modern replacement for a flat <select> full of preset labels: a categorized gallery of "channel
// style" template cards (M-on, MTV, HBO-style movie channel, etc. -- see ai-programming-presets.ts).
// Picking a card fills the instructions textarea and nudges the schedule-style select toward
// whatever rotation shape that style usually implies; both stay freely editable afterward.
export function ConceptPresetPicker({ idPrefix, selectedIndex, onSelect }: Props) {
  const [activeCategory, setActiveCategory] = useState<ConceptPresetCategory | "All">("All");
  const selected = CONCEPT_PRESETS[selectedIndex] ?? CONCEPT_PRESETS[0];
  const visible = useMemo(
    () => CONCEPT_PRESETS.filter((preset) => preset.category === "Custom" || activeCategory === "All" || preset.category === activeCategory),
    [activeCategory]
  );

  return (
    <div className="preset-picker" id={`${idPrefix}-concept-preset`}>
      <div className="preset-picker-tabs" role="tablist" aria-label="Template category">
        <button type="button" role="tab" aria-selected={activeCategory === "All"} className={`preset-tab${activeCategory === "All" ? " active" : ""}`} onClick={() => setActiveCategory("All")}>
          <Clapperboard size={13} /> All styles
        </button>
        {CONCEPT_PRESET_CATEGORIES.map((category) => (
          <button key={category} type="button" role="tab" aria-selected={activeCategory === category} className={`preset-tab${activeCategory === category ? " active" : ""}`} onClick={() => setActiveCategory(category)}>
            {category}
          </button>
        ))}
      </div>
      <div className="preset-grid">
        {visible.map((preset) => {
          const index = CONCEPT_PRESETS.indexOf(preset);
          const Icon = CATEGORY_ICONS[preset.category];
          const isSelected = index === selectedIndex;
          return (
            <button key={preset.label} type="button" className={`preset-card${isSelected ? " selected" : ""}`} aria-pressed={isSelected} onClick={() => onSelect(index, preset)}>
              {isSelected ? <CheckCircle2 size={15} className="preset-card-check" /> : <Icon size={15} className="preset-card-icon" />}
              <span className="preset-card-label">{preset.label}</span>
              <span className="preset-card-blurb">{preset.blurb}</span>
            </button>
          );
        })}
      </div>
      <span className="meta">{selected.blurb || "Fills the instructions below -- edit freely after picking one."}</span>
    </div>
  );
}
