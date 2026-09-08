// Shared between components/tunarr-channel-form.tsx (Sources) and
// components/channel-tunarr-publish-form.tsx (Channels) -- the only two places AI Programming is
// configured. Both are purely UI convenience: a "concept" preset just pre-fills the instructions
// textarea (still freely editable), and a "style" preset just picks one of lib/programming/types.ts's
// ScheduleStyle values, which is all that's actually persisted.
import { SCHEDULE_STYLES, type ScheduleStyle } from "@/lib/programming/types";

export const SCHEDULE_STYLE_OPTIONS: Array<{ value: ScheduleStyle; label: string; description: string }> = [
  { value: "daily-dayparts", label: "Daily dayparts", description: "Named blocks at fixed times, repeating every day (e.g. Morning, Primetime)." },
  { value: "weekly-broadcast", label: "Weekly broadcast", description: "Named blocks at fixed times, repeating every week -- different lineup per weekday." },
  { value: "endless-rotation", label: "Endless rotation", description: "No fixed times -- weighted shuffle with cooldowns, like a radio rotation." }
];
export const DEFAULT_SCHEDULE_STYLE: ScheduleStyle = SCHEDULE_STYLES[0];

export type ConceptPreset = { label: string; instructions: string };

export const CONCEPT_PRESETS: ConceptPreset[] = [
  { label: "Custom (write your own)", instructions: "" },
  { label: "Balanced variety", instructions: "Group similar clips together, but keep a good mix overall -- no single artist or mood dominating one block." },
  { label: "Throwback / retro countdown", instructions: "Favor a nostalgic, countdown-show feel -- older or classic-leaning clips first, building toward newer or more energetic ones." },
  { label: "Late night chill", instructions: "Calmer, mellower clips in the evening and overnight; save anything higher-energy for earlier in the day." },
  { label: "High energy / party", instructions: "Prioritize upbeat, high-energy clips throughout; keep quieter or slower clips to a minimum." }
];
