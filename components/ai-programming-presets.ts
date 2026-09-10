// Shared between components/tunarr-channel-form.tsx (Sources) and
// components/channel-tunarr-publish-form.tsx (Channels) -- the only two places AI Programming is
// configured. Both are purely UI convenience: a "concept" preset just pre-fills the instructions
// textarea (still freely editable) and optionally nudges the schedule-style select, and a "style"
// preset just picks one of lib/programming/types.ts's ScheduleStyle values -- that ScheduleStyle
// value (plus the free-text instructions) is all that's actually persisted; category/icon/blurb
// below exist only to drive components/concept-preset-picker.tsx's gallery UI.
import { SCHEDULE_STYLES, type ScheduleStyle } from "@/lib/programming/types";

export const SCHEDULE_STYLE_OPTIONS: Array<{ value: ScheduleStyle; label: string; description: string }> = [
  { value: "daily-dayparts", label: "Daily dayparts", description: "Named blocks at fixed times, repeating every day (e.g. Morning, Primetime)." },
  { value: "weekly-broadcast", label: "Weekly broadcast", description: "Named blocks at fixed times, repeating every week -- different lineup per weekday." },
  { value: "endless-rotation", label: "Endless rotation", description: "No fixed times -- weighted shuffle with cooldowns, like a radio rotation." }
];
export const DEFAULT_SCHEDULE_STYLE: ScheduleStyle = SCHEDULE_STYLES[0];

// Grouping for the preset gallery. "Custom" is a category of exactly one (index 0) and is always
// shown regardless of which tab is active -- see ConceptPresetPicker.
export type ConceptPresetCategory = "Custom" | "Music Video Channels" | "Broadcast & Variety" | "Movie Channels" | "Comedy & Sitcom" | "Mood & Format";

export const CONCEPT_PRESET_CATEGORIES: Exclude<ConceptPresetCategory, "Custom">[] = [
  "Music Video Channels",
  "Broadcast & Variety",
  "Movie Channels",
  "Comedy & Sitcom",
  "Mood & Format"
];

export type ConceptPreset = {
  label: string;
  /** One line shown on the preset card; also echoed under the picker once selected. */
  blurb: string;
  instructions: string;
  category: ConceptPresetCategory;
  /** Applied to the schedule-style select alongside the instructions when this preset is picked. */
  recommendedScheduleStyle?: ScheduleStyle;
};

export const CONCEPT_PRESETS: ConceptPreset[] = [
  { label: "Custom (write your own)", blurb: "Start blank and write your own instructions.", instructions: "", category: "Custom" },

  // Music Video Channels
  { label: "M-on Style", blurb: "Non-stop Japanese-style music video rotation, no dead air.", category: "Music Video Channels", recommendedScheduleStyle: "endless-rotation",
    instructions: "Non-stop music video rotation like a Japanese music channel (M-on!-style): flow smoothly between genres with no dead air, mix J-pop, anime theme songs, and international hits, and avoid repeating the same artist within a rotation." },
  { label: "Space Shower Style", blurb: "Indie, rock, and artist-driven music video rotation.", category: "Music Video Channels", recommendedScheduleStyle: "endless-rotation",
    instructions: "Alternative and rock-leaning rotation like Space Shower TV: favor indie, rock, and artist-driven music videos over mainstream pop, and let clips by the same artist or scene cluster loosely together." },
  { label: "MTV Style", blurb: "Mainstream pop and hip-hop, high energy throughout.", category: "Music Video Channels", recommendedScheduleStyle: "endless-rotation",
    instructions: "Mainstream, high-energy rotation like classic MTV: prioritize current pop, hip-hop, and dance hits, keep the energy up throughout, and slot in the occasional throwback as a change of pace." },
  { label: "VH1 Style", blurb: "Adult-contemporary hits with nostalgic, steady pacing.", category: "Music Video Channels", recommendedScheduleStyle: "endless-rotation",
    instructions: "Adult-contemporary rotation like classic VH1: favor well-known pop and rock hits with broad nostalgic appeal, keep the pace steady rather than high-energy, and lean toward artists with staying power over of-the-moment trends." },

  // Broadcast & Variety
  { label: "Regular TV Station", blurb: "Classic dayparts: mornings, afternoons, primetime, late night.", category: "Broadcast & Variety", recommendedScheduleStyle: "daily-dayparts",
    instructions: "Simulate a classic local TV station's daily schedule: upbeat, casual energy in the morning, lighter and family-friendly content in the afternoon, the strongest and most attention-grabbing clips in evening primetime, and slower, low-key content overnight." },
  { label: "Weekly Prime-Time Lineup", blurb: "A different themed lineup for each night of the week.", category: "Broadcast & Variety", recommendedScheduleStyle: "weekly-broadcast",
    instructions: "Build a weekly network-style lineup: give each day of the week its own loose theme or mood, keep the strongest clips in the evening slots, and repeat that same weekday pattern from week to week." },
  { label: "Variety TV", blurb: "Constantly changing moods, like flipping between segments.", category: "Broadcast & Variety", recommendedScheduleStyle: "endless-rotation",
    instructions: "Variety-show pacing: mix moods and types of clips frequently rather than grouping similar ones together, so watching feels like a broad variety show with something different every few minutes." },
  { label: "Local Access Weekend", blurb: "Laid-back, quirky, low-pressure weekend programming.", category: "Broadcast & Variety", recommendedScheduleStyle: "endless-rotation",
    instructions: "Relaxed public-access weekend feel: no strict structure, mix in quirky or offbeat clips freely, and keep the overall pace unhurried and low-pressure." },

  // Movie Channels
  { label: "Movie Channel (HBO Style)", blurb: "Feature-presentation pacing with a prestige evening premiere.", category: "Movie Channels", recommendedScheduleStyle: "daily-dayparts",
    instructions: "Premium movie-channel feel like HBO: treat longer clips as scheduled 'feature presentations' rather than a quick rotation, give the evening a prestige premiere slot for the strongest content, and avoid repeating anything within the same week." },
  { label: "Late-Night Grindhouse Movies", blurb: "Cult, B-movie energy pushed into the overnight hours.", category: "Movie Channels", recommendedScheduleStyle: "daily-dayparts",
    instructions: "Late-night grindhouse feel: push weirder, edgier, or more intense clips into the overnight hours, and keep daytime programming comparatively tame." },
  { label: "Classic Film Marathon", blurb: "Themed marathon nights, one era or genre at a time.", category: "Movie Channels", recommendedScheduleStyle: "weekly-broadcast",
    instructions: "Themed marathon programming: cluster clips from the same era, genre, or creator into one long block per night rather than mixing eras together, and give each night of the week its own theme." },

  // Comedy & Sitcom
  { label: "Comedy Channel", blurb: "Sitcom-style rerun blocks with laughs up front.", category: "Comedy & Sitcom", recommendedScheduleStyle: "daily-dayparts",
    instructions: "Sitcom rerun channel feel: group comedic or lighthearted clips into consistent blocks, lead each block with a strong, funny opener, and avoid placing serious or slow-paced content next to comedy blocks." },
  { label: "Stand-Up Special Block", blurb: "Long-form comedy specials treated like scheduled events.", category: "Comedy & Sitcom", recommendedScheduleStyle: "daily-dayparts",
    instructions: "Treat longer comedic or performance clips like scheduled stand-up specials: give them a dedicated evening slot rather than mixing them into a fast rotation, and keep shorter comedic clips as filler around them." },

  // Mood & Format
  { label: "Balanced Variety", blurb: "A good overall mix, no single mood dominating.", category: "Mood & Format", recommendedScheduleStyle: "endless-rotation",
    instructions: "Group similar clips together, but keep a good mix overall -- no single artist or mood dominating one block." },
  { label: "Throwback / Retro Countdown", blurb: "A nostalgic countdown, building from classic to new.", category: "Mood & Format", recommendedScheduleStyle: "weekly-broadcast",
    instructions: "Favor a nostalgic, countdown-show feel -- older or classic-leaning clips first, building toward newer or more energetic ones." },
  { label: "Late Night Chill", blurb: "Calmer clips at night, higher energy earlier in the day.", category: "Mood & Format", recommendedScheduleStyle: "daily-dayparts",
    instructions: "Calmer, mellower clips in the evening and overnight; save anything higher-energy for earlier in the day." },
  { label: "High Energy / Party", blurb: "Upbeat and energetic, start to finish.", category: "Mood & Format", recommendedScheduleStyle: "endless-rotation",
    instructions: "Prioritize upbeat, high-energy clips throughout; keep quieter or slower clips to a minimum." }
];
