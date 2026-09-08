import { AppError } from "@/lib/api";

type JsonObject = Record<string, unknown>;

export type TunarrVersion = { tunarr: string; ffmpeg: string; nodejs: string };
export type TunarrLibrary = { id: string; name: string; mediaType: string; externalKey: string; enabled: boolean };
export type TunarrMediaSource = { id: string; name: string; type: string; paths?: string[]; libraries: TunarrLibrary[] };
export type TunarrChannel = { id: string; name: string; number: number; [key: string]: unknown };
export type TunarrProgram = { type: "content"; id: string; duration: number; program?: { externalId?: string; [key: string]: unknown } };
export type TunarrCustomShow = { id: string; name: string; contentCount: number; totalDuration: number };

// A Tunarr "time" schedule slot backed by a Custom Show -- see lib/programming/schedule-builder.ts.
// Tunarr's slot union also has movie/show/flex/redirect/filler/smart-collection variants (see
// types/src/api/CommonSlots.ts in the Tunarr source); this app only ever constructs custom-show slots,
// so the other variants aren't modeled here.
export type TunarrCustomShowSlot = {
  id: string; // uuid, stable across republishes so a later publish updates this slot in place
  type: "custom-show";
  customShowId: string;
  order: "next" | "shuffle" | "ordered_shuffle" | "alphanumeric" | "chronological";
  direction?: "asc" | "desc";
  startTime: number; // ms offset from the period start (midnight for "day", Monday 00:00 for "week")
};

export type TunarrTimeSlotSchedule = {
  type: "time";
  flexPreference: "distribute" | "end";
  latenessMs: number;
  maxDays: number;
  padMs: number;
  period: "day" | "week";
  slots: TunarrCustomShowSlot[];
  timeZoneOffset: number;
  startTomorrow?: boolean;
};

// A Tunarr "random" schedule slot backed by a Custom Show -- the counterpart to TunarrCustomShowSlot
// for endless, weighted/cooldown-based rotation instead of fixed daily start times. See
// lib/programming/schedule-builder.ts:buildTunarrRotationSchedule.
export type TunarrRandomCustomShowSlot = {
  id: string; // uuid, stable across republishes so a later publish updates this slot in place
  type: "custom-show";
  customShowId: string;
  order: "next" | "shuffle" | "ordered_shuffle" | "alphanumeric" | "chronological";
  direction?: "asc" | "desc";
  weight: number;
  cooldownMs: number;
  durationSpec: { type: "dynamic"; programCount: number } | { type: "fixed"; durationMs: number };
};

export type TunarrRandomSlotSchedule = {
  type: "random";
  flexPreference: "distribute" | "end";
  maxDays: number;
  padMs: number;
  padStyle: "slot" | "episode";
  slots: TunarrRandomCustomShowSlot[];
  timeZoneOffset?: number;
  randomDistribution: "uniform" | "weighted" | "none";
  periodMs?: number;
  lockWeights: boolean;
};

// One entry from a materialized lineup, returned by both the schedule-time-slots/schedule-slots
// preview endpoints and (indirectly) what gets persisted -- deliberately loose (only the fields
// lib/programming/schedule-builder.ts's dry-run validation actually inspects) rather than a full port
// of Tunarr's CondensedChannelProgram union.
export type TunarrMaterializedLineupEntry = { type: string; duration: number | null; customShowId?: string };

export type TunarrCapabilities = {
  localMedia: boolean;
  channelCreate: boolean;
  channelUpdate: boolean;
  programming: boolean;
  aiScheduling: boolean;
};

const REQUIRED_OPERATIONS = {
  localMedia: [["/api/media-sources", "get"], ["/api/media-sources", "post"], ["/api/media-sources/{id}/libraries/{libraryId}/scan", "post"], ["/api/media-sources/{mediaSourceId}/{libraryId}/status", "get"], ["/api/media-libraries/{libraryId}/programs", "get"]],
  channelCreate: [["/api/channels", "get"], ["/api/channels", "post"], ["/api/transcode_configs", "get"]],
  channelUpdate: [["/api/channels/{id}", "put"]],
  programming: [["/api/channels/{id}/programming", "post"]],
  // Only required when programmingOrder/aiProvider actually selects AI scheduling (checked separately
  // in lib/tunarr/service.ts / lib/tunarr/channel-service.ts, not folded into the base "programming"
  // requirement above, so a Tunarr server without Custom Shows can still publish ordinary lineups). The
  // schedule-time-slots/schedule-slots preview endpoints are required too -- lib/programming/
  // schedule-builder.ts dry-runs every AI-generated schedule through them before persisting.
  aiScheduling: [
    ["/api/custom-shows", "get"], ["/api/custom-shows", "post"], ["/api/custom-shows/{id}", "put"],
    ["/api/channels/{channelId}/schedule-time-slots", "post"], ["/api/channels/{channelId}/schedule-slots", "post"]
  ]
} as const;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function errorText(value: unknown) {
  if (typeof value === "string") return value;
  const candidate = object(value);
  return typeof candidate?.message === "string" ? candidate.message : "Tunarr returned an unexpected response.";
}

export class TunarrApiClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 15_000) {}

  private async request(path: string, init?: RequestInit, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: combined,
        cache: "no-store",
        headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError("TUNARR_UNREACHABLE", `Could not reach Tunarr at ${this.baseUrl}: ${message}`, 502);
    }
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (!response.ok) {
      throw new AppError("TUNARR_API_ERROR", `Tunarr ${response.status}: ${errorText(body)}`, 502, { status: response.status, path });
    }
    return body;
  }

  async discover(signal?: AbortSignal) {
    const spec = object(await this.request("/openapi.json", undefined, signal));
    const paths = object(spec?.paths);
    if (!paths) throw new AppError("TUNARR_DISCOVERY_FAILED", "Tunarr did not expose a usable OpenAPI document at /openapi.json.", 502);
    const capabilities = Object.fromEntries(Object.entries(REQUIRED_OPERATIONS).map(([name, operations]) => [
      name,
      operations.every(([path, method]) => Boolean(object(paths[path])?.[method]))
    ])) as TunarrCapabilities;
    const info = object(spec?.info);
    return { openApiVersion: typeof info?.version === "string" ? info.version : null, capabilities };
  }

  async testConnection(signal?: AbortSignal) {
    const [versionBody, discovery, healthBody] = await Promise.all([
      this.request("/api/version", undefined, signal),
      this.discover(signal),
      this.request("/api/system/health", undefined, signal)
    ]);
    const version = object(versionBody);
    if (typeof version?.tunarr !== "string") throw new AppError("TUNARR_INVALID_RESPONSE", "The configured server did not return a Tunarr version.", 502);
    return {
      connected: true as const,
      version: { tunarr: version.tunarr, ffmpeg: String(version.ffmpeg ?? "unknown"), nodejs: String(version.nodejs ?? "unknown") } satisfies TunarrVersion,
      health: healthBody,
      ...discovery
    };
  }

  async listMediaSources(signal?: AbortSignal): Promise<TunarrMediaSource[]> {
    const body = await this.request("/api/media-sources", undefined, signal);
    if (!Array.isArray(body)) throw new AppError("TUNARR_INVALID_RESPONSE", "Tunarr returned invalid media-source data.", 502);
    return body.flatMap((item) => {
      const value = object(item);
      if (!value || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.type !== "string") return [];
      const libraries = Array.isArray(value.libraries) ? value.libraries.flatMap((entry) => {
        const library = object(entry);
        return library && typeof library.id === "string" && typeof library.name === "string"
          ? [{ id: library.id, name: library.name, mediaType: String(library.mediaType ?? ""), externalKey: String(library.externalKey ?? ""), enabled: library.enabled !== false }]
          : [];
      }) : [];
      return [{ id: value.id, name: value.name, type: value.type, paths: Array.isArray(value.paths) ? value.paths.filter((candidate): candidate is string => typeof candidate === "string") : undefined, libraries }];
    });
  }

  async createLocalMediaSource(name: string, mediaDirectory: string, signal?: AbortSignal) {
    const body = object(await this.request("/api/media-sources", {
      method: "POST",
      body: JSON.stringify({ name, type: "local", mediaType: "other_videos", paths: [mediaDirectory], pathReplacements: [] })
    }, signal));
    if (typeof body?.id !== "string") throw new AppError("TUNARR_INVALID_RESPONSE", "Tunarr created a media source but did not return its ID.", 502);
    return body.id;
  }

  // Sibling to createLocalMediaSource, not a change to it: the channel-generator publish path
  // (lib/tunarr/channel-service.ts) needs Tunarr's "music_videos" scanner (which reads the Kodi
  // <musicvideo> NFOs this app writes for rendered channel output, lib/sidecar/nfo.ts) instead of
  // the "other_videos" scanner Sources use.
  async createMusicVideoLocalMediaSource(name: string, mediaDirectory: string, signal?: AbortSignal) {
    const body = object(await this.request("/api/media-sources", {
      method: "POST",
      body: JSON.stringify({ name, type: "local", mediaType: "music_videos", paths: [mediaDirectory], pathReplacements: [] })
    }, signal));
    if (typeof body?.id !== "string") throw new AppError("TUNARR_INVALID_RESPONSE", "Tunarr created a media source but did not return its ID.", 502);
    return body.id;
  }

  async scanLibrary(mediaSourceId: string, libraryId: string, signal?: AbortSignal) {
    await this.request(`/api/media-sources/${encodeURIComponent(mediaSourceId)}/libraries/${encodeURIComponent(libraryId)}/scan?forceScan=true`, { method: "POST" }, signal);
  }

  async waitForLibraryScan(mediaSourceId: string, libraryId: string, signal?: AbortSignal, isReady?: () => Promise<boolean>) {
    const deadline = Date.now() + 120_000;
    let observedScan = false;
    while (Date.now() < deadline) {
      const status = object(await this.request(`/api/media-sources/${encodeURIComponent(mediaSourceId)}/${encodeURIComponent(libraryId)}/status`, undefined, signal));
      if (status?.state === "not_scanning") {
        // The scan endpoint only queues work, so its first status response can
        // still describe the idle state from before the queued scan starts.
        if (observedScan || !isReady || await isReady()) return;
      } else {
        observedScan = true;
      }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1_000);
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
    }
    throw new AppError("TUNARR_SCAN_TIMEOUT", "Tunarr did not finish scanning the source directory within two minutes.", 504);
  }

  async listLibraryPrograms(libraryId: string, signal?: AbortSignal): Promise<TunarrProgram[]> {
    const body = await this.request(`/api/media-libraries/${encodeURIComponent(libraryId)}/programs`, undefined, signal);
    if (!Array.isArray(body)) throw new AppError("TUNARR_INVALID_RESPONSE", "Tunarr returned invalid library program data.", 502);
    return body.flatMap((item) => {
      const value = object(item);
      const program = object(value?.program);
      return value?.type === "content" && typeof value.id === "string" && typeof value.duration === "number"
        ? [{ type: "content" as const, id: value.id, duration: value.duration, program: program ?? undefined }]
        : [];
    });
  }

  async listChannels(signal?: AbortSignal): Promise<TunarrChannel[]> {
    const body = await this.request("/api/channels", undefined, signal);
    if (!Array.isArray(body)) throw new AppError("TUNARR_INVALID_RESPONSE", "Tunarr returned invalid channel data.", 502);
    return body.flatMap((item) => {
      const value = object(item);
      return value && typeof value.id === "string" && typeof value.name === "string" && typeof value.number === "number"
        ? [value as TunarrChannel]
        : [];
    });
  }

  async getDefaultTranscodeConfigId(signal?: AbortSignal) {
    const body = await this.request("/api/transcode_configs", undefined, signal);
    if (!Array.isArray(body)) throw new AppError("TUNARR_INVALID_RESPONSE", "Tunarr returned invalid transcode configuration data.", 502);
    const configs = body.map(object).filter((item): item is JsonObject => Boolean(item));
    const config = configs.find((item) => item.isDefault === true) ?? configs[0];
    if (typeof config?.id !== "string") throw new AppError("TUNARR_NO_TRANSCODE_CONFIG", "Tunarr has no transcode configuration available for the new channel.", 422);
    return config.id;
  }

  async createChannel(channel: JsonObject, signal?: AbortSignal) {
    const body = object(await this.request("/api/channels", { method: "POST", body: JSON.stringify({ type: "new", channel }) }, signal));
    if (typeof body?.id !== "string") throw new AppError("TUNARR_INVALID_RESPONSE", "Tunarr created a channel but did not return its ID.", 502);
    return body as TunarrChannel;
  }

  async updateChannel(channelId: string, channel: JsonObject, signal?: AbortSignal) {
    await this.request(`/api/channels/${encodeURIComponent(channelId)}`, { method: "PUT", body: JSON.stringify(channel) }, signal);
  }

  async replaceProgramming(channelId: string, lineup: Array<{ type: "content"; id: string; duration: number }>, signal?: AbortSignal) {
    await this.request(`/api/channels/${encodeURIComponent(channelId)}/programming`, {
      method: "POST",
      body: JSON.stringify({ type: "manual", lineup, append: false })
    }, signal);
  }

  // AI-scheduled programming (lib/programming/schedule-builder.ts) posts a "time" lineup instead of a
  // flat "manual" one -- Tunarr materializes the actual repeating lineup server-side from the schedule.
  // `programs` is the pool the schema requires alongside the schedule; every clip this app schedules
  // lives inside a Custom Show rather than the top-level pool, so this is always sent empty -- kept as
  // a parameter (not hardcoded) in case a future slot type needs it populated.
  async replaceProgrammingWithSchedule(channelId: string, programs: string[], schedule: TunarrTimeSlotSchedule, signal?: AbortSignal) {
    await this.request(`/api/channels/${encodeURIComponent(channelId)}/programming`, {
      method: "POST",
      body: JSON.stringify({ type: "time", programs, schedule })
    }, signal);
  }

  async listCustomShows(signal?: AbortSignal): Promise<TunarrCustomShow[]> {
    const body = await this.request("/api/custom-shows", undefined, signal);
    if (!Array.isArray(body)) throw new AppError("TUNARR_INVALID_RESPONSE", "Tunarr returned invalid custom show data.", 502);
    return body.flatMap((item) => {
      const value = object(item);
      return value && typeof value.id === "string" && typeof value.name === "string"
        ? [{ id: value.id, name: value.name, contentCount: Number(value.contentCount ?? 0), totalDuration: Number(value.totalDuration ?? 0) }]
        : [];
    });
  }

  async createCustomShow(name: string, programs: Array<{ type: "content"; id: string; duration: number }>, signal?: AbortSignal) {
    const body = object(await this.request("/api/custom-shows", {
      method: "POST",
      body: JSON.stringify({ name, programs, syncMediaSourceId: null, syncMediaSourceType: null, syncExternalPlaylistId: null })
    }, signal));
    if (typeof body?.id !== "string") throw new AppError("TUNARR_INVALID_RESPONSE", "Tunarr created a custom show but did not return its ID.", 502);
    return body.id;
  }

  async updateCustomShow(id: string, name: string, programs: Array<{ type: "content"; id: string; duration: number }>, signal?: AbortSignal) {
    await this.request(`/api/custom-shows/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ name, programs, enableSync: false })
    }, signal);
  }

  // The "random" counterpart to replaceProgrammingWithSchedule -- see TunarrRandomSlotSchedule.
  async replaceProgrammingWithRandomSchedule(channelId: string, programs: string[], schedule: TunarrRandomSlotSchedule, signal?: AbortSignal) {
    await this.request(`/api/channels/${encodeURIComponent(channelId)}/programming`, {
      method: "POST",
      body: JSON.stringify({ type: "random", programs, schedule })
    }, signal);
  }

  private parseMaterializedLineup(body: unknown): TunarrMaterializedLineupEntry[] {
    const value = object(body);
    const lineup = Array.isArray(value?.lineup) ? value.lineup : null;
    if (!lineup) throw new AppError("TUNARR_INVALID_RESPONSE", "Tunarr returned an invalid schedule preview.", 502);
    return lineup.map((item) => {
      const entry = object(item);
      const duration = typeof entry?.duration === "number" && Number.isFinite(entry.duration) ? entry.duration : null;
      return { type: typeof entry?.type === "string" ? entry.type : "unknown", duration, customShowId: typeof entry?.customShowId === "string" ? entry.customShowId : undefined };
    });
  }

  // Dry-runs a "time" schedule: materializes what the lineup would actually look like without
  // persisting anything. lib/programming/schedule-builder.ts uses this to catch a degenerate schedule
  // (a null/non-finite duration, or a slot the materializer never actually reaches) before publishing
  // it -- exactly the failure mode a padMs/flexPreference mismatch produced when this was first tested
  // live against Tunarr 1.3.14.
  async previewTimeSlotSchedule(channelId: string, schedule: TunarrTimeSlotSchedule, signal?: AbortSignal): Promise<TunarrMaterializedLineupEntry[]> {
    const body = await this.request(`/api/channels/${encodeURIComponent(channelId)}/schedule-time-slots`, { method: "POST", body: JSON.stringify({ schedule }) }, signal);
    return this.parseMaterializedLineup(body);
  }

  // The "random" counterpart to previewTimeSlotSchedule.
  async previewRandomSlotSchedule(channelId: string, schedule: TunarrRandomSlotSchedule, signal?: AbortSignal): Promise<TunarrMaterializedLineupEntry[]> {
    const body = await this.request(`/api/channels/${encodeURIComponent(channelId)}/schedule-slots`, { method: "POST", body: JSON.stringify({ schedule }) }, signal);
    return this.parseMaterializedLineup(body);
  }

  // Reads back whatever schedule config is currently persisted on a channel (not a materialized
  // lineup) -- null for a channel with no schedule (e.g. a plain manual lineup, or nothing published
  // yet). Used for status/reconciliation, not by the publish flow itself.
  async getMaterializedSchedule(channelId: string, signal?: AbortSignal): Promise<TunarrTimeSlotSchedule | TunarrRandomSlotSchedule | null> {
    const body = object(await this.request(`/api/channels/${encodeURIComponent(channelId)}/schedule`, undefined, signal));
    const schedule = object(body?.schedule);
    if (!schedule || (schedule.type !== "time" && schedule.type !== "random")) return null;
    return schedule as unknown as TunarrTimeSlotSchedule | TunarrRandomSlotSchedule;
  }
}
