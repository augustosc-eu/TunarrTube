import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api";
import { writeLog } from "@/lib/logging/service";
import type {
  TunarrApiClient, TunarrCustomShowSlot, TunarrMaterializedLineupEntry, TunarrProgram,
  TunarrRandomCustomShowSlot, TunarrRandomSlotSchedule, TunarrTimeSlotSchedule
} from "@/lib/tunarr/client";
import type { ProgrammingGroup, ProgrammingPlan, StoredProgrammingPlan } from "@/lib/programming/types";

type BuiltSchedule<TSchedule> = { schedule: TSchedule; programs: string[]; tunarr: NonNullable<StoredProgrammingPlan["tunarr"]> };

// Resolves each block/group's clip IDs to real scanned Tunarr programs, creating or updating one
// Custom Show per label (reusing the previous publish's IDs so a republish updates in place rather
// than duplicating), and returns the Custom Show's Tunarr id alongside a stable per-label slot uuid.
// Shared by both schedule kinds below -- everything after this differs (the schedule shape itself,
// and which preview endpoint validates it), but "one Custom Show per label" is identical.
async function buildCustomShows(input: {
  client: TunarrApiClient;
  labels: Array<{ label: string; itemIds: string[] }>;
  programIndex: Map<string, TunarrProgram>;
  namePrefix: string;
  previous: StoredProgrammingPlan["tunarr"];
  signal?: AbortSignal;
}) {
  const tunarr: NonNullable<StoredProgrammingPlan["tunarr"]> = {};
  const resolved: Array<{ label: string; customShowId: string; slotId: string }> = [];
  let skipped = 0;

  for (const entry of input.labels) {
    const programs = entry.itemIds.flatMap((id) => {
      const program = input.programIndex.get(id);
      return program && program.duration > 0 ? [{ type: "content" as const, id: program.id, duration: program.duration }] : [];
    });
    if (!programs.length) {
      // Every candidate the AI referenced turned out to be unscanned/zero-duration (e.g. its download
      // hasn't finished, or the file disappeared) -- skip rather than create an empty Custom Show
      // Tunarr would reject or silently ignore.
      skipped += 1;
      continue;
    }
    const name = `${input.namePrefix} — ${entry.label}`;
    const existing = input.previous?.[entry.label];
    let customShowId: string;
    if (existing) {
      await input.client.updateCustomShow(existing.customShowId, name, programs, input.signal);
      customShowId = existing.customShowId;
    } else {
      customShowId = await input.client.createCustomShow(name, programs, input.signal);
    }
    const slotId = existing?.slotId ?? randomUUID();
    tunarr[entry.label] = { customShowId, slotId };
    resolved.push({ label: entry.label, customShowId, slotId });
  }

  if (skipped) {
    await writeLog({ level: "warn", category: "tunarr", message: `AI programming: skipped ${skipped} block${skipped === 1 ? "" : "s"}/group${skipped === 1 ? "" : "s"} with no scanned media.` });
  }
  return { tunarr, resolved };
}

// Regression guard against the exact failure class first caught live against Tunarr 1.3.14: a
// flexPreference/padMs mismatch fed Tunarr's own scheduler a division by zero, which corrupted the
// schedule's internal time cursor. The symptom was invisible until publish actually failed with a
// cryptic "NOT NULL constraint failed: channel.duration" -- but it was already visible in the
// *materialized preview* as (a) a null/non-finite duration on some lineup entry, and (b) some
// referenced Custom Show never actually appearing in the materialized lineup at all (the scheduler got
// stuck re-resolving an earlier slot forever). Checking both here means any future schedule-shape bug
// gets caught before it reaches a real channel, not after.
// requireAllSeen is true for dayparts (a fixed daily/weekly schedule *must* reach every slot at least
// once within the preview window -- if it doesn't, the scheduler is stuck) and false for rotation
// (a weighted/cooldown-based shuffle legitimately might not pick every group within a short preview
// window; only the null-duration check applies there).
function validateMaterializedLineup(lineup: TunarrMaterializedLineupEntry[], expectedCustomShowIds: Set<string>, requireAllSeen: boolean) {
  const bad = lineup.find((entry) => entry.duration === null);
  if (bad) {
    throw new AppError("AI_SCHEDULE_DEGENERATE", "Tunarr's schedule preview produced a non-finite duration for this schedule -- refusing to publish it. This usually means a scheduling parameter Tunarr doesn't accept for this shape of content; please report this.", 502);
  }
  if (!requireAllSeen) return;
  const seen = new Set(lineup.flatMap((entry) => (entry.customShowId ? [entry.customShowId] : [])));
  const missing = [...expectedCustomShowIds].filter((id) => !seen.has(id));
  if (missing.length) {
    throw new AppError("AI_SCHEDULE_DEGENERATE", `Tunarr's schedule preview never reached ${missing.length} of the ${expectedCustomShowIds.size} scheduled block(s) -- refusing to publish a schedule that would silently drop content.`, 502);
  }
}

// Turns a validated "dayparts" ProgrammingPlan into real Tunarr state: one Custom Show per block plus
// a "time" schedule referencing them, dry-run validated via Tunarr's own schedule-time-slots preview
// endpoint before being returned. Shared by lib/tunarr/service.ts (Sources) and
// lib/tunarr/channel-service.ts (Channels).
export async function buildTunarrSchedule(input: {
  client: TunarrApiClient;
  plan: Extract<ProgrammingPlan, { kind: "dayparts" }>;
  programIndex: Map<string, TunarrProgram>;
  namePrefix: string;
  previous: StoredProgrammingPlan["tunarr"];
  channelId: string;
  signal?: AbortSignal;
}): Promise<BuiltSchedule<TunarrTimeSlotSchedule>> {
  const { tunarr, resolved } = await buildCustomShows({ client: input.client, labels: input.plan.blocks, programIndex: input.programIndex, namePrefix: input.namePrefix, previous: input.previous, signal: input.signal });
  if (!resolved.length) {
    throw new AppError("AI_SCHEDULE_EMPTY", "None of the AI's scheduled clips were found in Tunarr's scanned library -- try republishing after downloads finish.", 422);
  }
  const slots: TunarrCustomShowSlot[] = input.plan.blocks.flatMap((block) => {
    const built = tunarr[block.label];
    return built ? [{ id: built.slotId, type: "custom-show" as const, customShowId: built.customShowId, order: "next" as const, direction: "asc" as const, startTime: block.startMinutes * 60_000 }] : [];
  }).sort((a, b) => a.startTime - b.startTime);

  const schedule: TunarrTimeSlotSchedule = {
    type: "time",
    // "end" (not "distribute"), and deliberately so -- confirmed live against Tunarr 1.3.14: with
    // padMs: 0, "distribute" divides the slot's leftover time by padMs inside Tunarr's own
    // slotSchedulerUtil.ts:distributeFlex (`remainingTime % padMs`), which is a division by zero (NaN)
    // whenever a slot's content doesn't exactly fill it -- the common case here, since a block is
    // whatever duration its clips add up to, not a duration TunarrTube chose to match the slot. That NaN
    // poisons the time cursor and the scheduler never advances past the first slot, which is what
    // actually produced the "channel created but empty" symptom and the "NOT NULL constraint failed:
    // channel.duration" 500 on publish. "end" (put all of a slot's leftover time at the end, once) never
    // takes that division path, and is also the semantically right choice for a plain ordered clip list
    // like ours -- there's nothing to "distribute" flex *between*.
    flexPreference: "end",
    latenessMs: 5 * 60_000,
    maxDays: input.plan.period === "week" ? 14 : 2,
    padMs: 0,
    period: input.plan.period,
    slots,
    // Node's getTimezoneOffset() is minutes *behind* UTC (positive west of Greenwich); Tunarr's own
    // source code comments this field "tz offset in...minutes, i think?" -- i.e. even Tunarr's authors
    // aren't fully certain of the sign/units. Unverified against a live "time"-scheduled channel; if
    // dayparts land an hour or more off, this is the first thing to check.
    timeZoneOffset: new Date().getTimezoneOffset(),
    startTomorrow: false
  };

  const preview = await input.client.previewTimeSlotSchedule(input.channelId, schedule, input.signal);
  validateMaterializedLineup(preview, new Set(resolved.map((entry) => entry.customShowId)), true);

  // Every referenced clip lives inside a Custom Show, not the top-level program pool -- see
  // TunarrApiClient.replaceProgrammingWithSchedule's comment on why this is empty rather than the
  // scanned library's full id list.
  return { schedule, programs: [], tunarr };
}

// Turns a validated "rotation" ProgrammingPlan into real Tunarr state: one Custom Show per group plus
// a "random" schedule referencing them (weighted, with a per-group cooldown), dry-run validated via
// Tunarr's schedule-slots preview endpoint. Structurally the rotation counterpart to
// buildTunarrSchedule above.
export async function buildTunarrRotationSchedule(input: {
  client: TunarrApiClient;
  plan: Extract<ProgrammingPlan, { kind: "rotation" }>;
  programIndex: Map<string, TunarrProgram>;
  namePrefix: string;
  previous: StoredProgrammingPlan["tunarr"];
  channelId: string;
  signal?: AbortSignal;
}): Promise<BuiltSchedule<TunarrRandomSlotSchedule>> {
  const labels: Array<{ label: string; itemIds: string[] }> = input.plan.groups;
  const { tunarr, resolved } = await buildCustomShows({ client: input.client, labels, programIndex: input.programIndex, namePrefix: input.namePrefix, previous: input.previous, signal: input.signal });
  if (!resolved.length) {
    throw new AppError("AI_SCHEDULE_EMPTY", "None of the AI's scheduled clips were found in Tunarr's scanned library -- try republishing after downloads finish.", 422);
  }
  const groupsByLabel = new Map<string, ProgrammingGroup>(input.plan.groups.map((group) => [group.label, group]));
  const slots: TunarrRandomCustomShowSlot[] = resolved.map((entry) => {
    const group = groupsByLabel.get(entry.label)!;
    return {
      id: entry.slotId, type: "custom-show", customShowId: entry.customShowId,
      order: "shuffle", direction: "asc",
      weight: group.weight,
      cooldownMs: group.cooldownMinutes * 60_000,
      durationSpec: { type: "dynamic", programCount: 1 }
    };
  });

  const schedule: TunarrRandomSlotSchedule = {
    type: "random",
    // Same reasoning as buildTunarrSchedule above -- "end" avoids Tunarr's distributeFlex division
    // entirely regardless of padMs, and there's nothing to distribute flex *between* here either.
    flexPreference: "end",
    maxDays: 2,
    padMs: 0,
    padStyle: "slot",
    slots,
    timeZoneOffset: new Date().getTimezoneOffset(),
    randomDistribution: "weighted",
    lockWeights: false
  };

  const preview = await input.client.previewRandomSlotSchedule(input.channelId, schedule, input.signal);
  validateMaterializedLineup(preview, new Set(resolved.map((entry) => entry.customShowId)), false);

  return { schedule, programs: [], tunarr };
}
