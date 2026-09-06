import { AppError } from "@/lib/api";

type JsonObject = Record<string, unknown>;

export type TunarrVersion = { tunarr: string; ffmpeg: string; nodejs: string };
export type TunarrLibrary = { id: string; name: string; mediaType: string; externalKey: string; enabled: boolean };
export type TunarrMediaSource = { id: string; name: string; type: string; paths?: string[]; libraries: TunarrLibrary[] };
export type TunarrChannel = { id: string; name: string; number: number; [key: string]: unknown };
export type TunarrProgram = { type: "content"; id: string; duration: number; program?: { externalId?: string; [key: string]: unknown } };

export type TunarrCapabilities = {
  localMedia: boolean;
  channelCreate: boolean;
  channelUpdate: boolean;
  programming: boolean;
};

const REQUIRED_OPERATIONS = {
  localMedia: [["/api/media-sources", "get"], ["/api/media-sources", "post"], ["/api/media-sources/{id}/libraries/{libraryId}/scan", "post"], ["/api/media-sources/{mediaSourceId}/{libraryId}/status", "get"], ["/api/media-libraries/{libraryId}/programs", "get"]],
  channelCreate: [["/api/channels", "get"], ["/api/channels", "post"], ["/api/transcode_configs", "get"]],
  channelUpdate: [["/api/channels/{id}", "put"]],
  programming: [["/api/channels/{id}/programming", "post"]]
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
}
