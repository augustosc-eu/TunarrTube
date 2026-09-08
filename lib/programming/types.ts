// Shared types for AI-generated Tunarr programming. A "candidate" is one clip TunarrTube could put
// somewhere in the schedule; ids are our own stable ids (Video.youtubeId for a Source, MediaItem.id
// for a Channel -- see lib/tunarr/service.ts and lib/tunarr/channel-service.ts) so a generated plan
// survives a Tunarr rescan even though it references nothing Tunarr-side directly. Duration comes from
// our own DB (the same file Tunarr will scan), not a live Tunarr call, so plan generation never needs a
// Tunarr round-trip.
export type ProgrammingCandidate = {
  id: string;
  title: string;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  durationMs: number;
  uploadDate?: string | null;
};

// The two schedule shapes TunarrTube can build, corresponding 1:1 to the two schedule-*building*
// Tunarr endpoints (schedule-time-slots / schedule-slots) and the two "type"s replaceProgramming*
// posts. Picked per Source/Channel via ScheduleStyle (see below) -- a "preset" is just a fixed
// (kind, period) pairing plus a display label, nothing more.
export type ProgrammingKind = "dayparts" | "rotation";

// A named daypart: a start offset (minutes from midnight, or from the start of the week for a "week"
// period) and the ordered candidate ids that should play there. itemIds must be a subset of the
// candidate ids passed to the provider -- lib/programming/ai-service.ts enforces this after parsing.
export type ProgrammingBlock = {
  label: string;
  startMinutes: number;
  itemIds: string[];
};

// A named rotation bucket: no fixed time, just a relative weight (how often it's picked relative to
// other groups) and a cooldown (minimum time before the same bucket can play again). Good for
// "endless shuffle" style channels where dayparting doesn't make sense.
export type ProgrammingGroup = {
  label: string;
  itemIds: string[];
  weight: number;
  cooldownMinutes: number;
};

export type ProgrammingPlan =
  | { kind: "dayparts"; period: "day" | "week"; blocks: ProgrammingBlock[] }
  | { kind: "rotation"; groups: ProgrammingGroup[] };

// Schedule-style presets shown in the UI -- each just fixes which ProgrammingKind (and, for dayparts,
// which period) to ask the AI for. Purely a UI convenience: the underlying (kind, period) pair is all
// that's actually persisted (Source|Channel.aiScheduleStyle stores this key directly).
export const SCHEDULE_STYLES = ["daily-dayparts", "weekly-broadcast", "endless-rotation"] as const;
export type ScheduleStyle = (typeof SCHEDULE_STYLES)[number];

export function scheduleStyleToKind(style: ScheduleStyle): { kind: ProgrammingKind; period: "day" | "week" } {
  switch (style) {
    case "weekly-broadcast": return { kind: "dayparts", period: "week" };
    case "endless-rotation": return { kind: "rotation", period: "day" };
    case "daily-dayparts": default: return { kind: "dayparts", period: "day" };
  }
}

export const AI_PROVIDERS = ["anthropic", "openai"] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];
// "auto" is only a valid *setting* (AppSettings.aiProvider / Source|Channel.aiProvider) -- resolving it
// to a concrete AiProviderName happens in lib/programming/provider.ts.
export type AiProviderSetting = AiProviderName | "auto";

// Cached on Source.aiProgrammingPlanJson / Channel.aiProgrammingPlanJson. candidatesSignature and
// instructions (and now scheduleStyle) are compared against the current inputs on every publish to
// decide whether the plan is still fresh or needs regenerating
// (lib/programming/ai-service.ts:ensureProgrammingPlan) -- regenerating means another billed call to
// whichever AI provider ran, so this cache is load-bearing, not just an optimization.
export type StoredProgrammingPlan = {
  plan: ProgrammingPlan;
  provider: AiProviderName;
  instructions: string | null;
  candidatesSignature: string;
  generatedAt: string;
  // Tunarr-side state from the last successful publish, keyed by block/group label so a later publish
  // updates the same Custom Show and schedule slot in place instead of creating duplicates. Populated
  // by lib/programming/schedule-builder.ts, persisted by the publish flow alongside the plan itself.
  tunarr?: Record<string, { customShowId: string; slotId: string }>;
};
