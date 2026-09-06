type JsonObject = Record<string, unknown>;

const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: JsonObject) => ({ "application/json": { schema } });
const envelope = (schema: JsonObject) => ({
  type: "object",
  required: ["data"],
  properties: { data: schema }
});
const response = (description: string, schema: JsonObject) => ({
  description,
  content: json(envelope(schema))
});
const requestBody = (name: string) => ({ required: true, content: json(schemaRef(name)) });
const pathParameter = (name: string, description: string) => ({
  name, in: "path", required: true, description, schema: { type: "string", minLength: 1 }
});
const queryParameter = (name: string, description: string, required = false) => ({
  name, in: "query", required, description, schema: { type: "string", ...(required ? { minLength: 1 } : {}) }
});

const errorResponses = {
  "400": { $ref: "#/components/responses/BadRequest" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "404": { $ref: "#/components/responses/NotFound" },
  "409": { $ref: "#/components/responses/Conflict" },
  "422": { $ref: "#/components/responses/UnprocessableEntity" },
  "500": { $ref: "#/components/responses/InternalError" }
};

type Operation = {
  path: string;
  method: "get" | "post" | "patch" | "delete" | "head";
  operationId: string;
  tag: string;
  summary: string;
  status?: string;
  result?: JsonObject;
  body?: string;
  parameters?: JsonObject[];
  description?: string;
  rawResponses?: JsonObject;
};

const sourceId = pathParameter("id", "TunarrTube source ID.");
const operations: Operation[] = [
  { path: "/openapi.json", method: "get", operationId: "getOpenApiDocument", tag: "System", summary: "Get this OpenAPI document", rawResponses: {
    "200": { description: "The OpenAPI 3.1 contract.", content: json({ type: "object" }) }
  } },
  { path: "/api/health", method: "get", operationId: "getHealth", tag: "System", summary: "Check application readiness", rawResponses: {
    "200": { description: "The database and scheduler are ready.", content: json(schemaRef("Health")) },
    "503": { description: "The app is starting or unhealthy.", content: json(schemaRef("Health")) }
  } },
  { path: "/api/sources/analyze", method: "post", operationId: "analyzeSource", tag: "Sources", summary: "Analyze a public YouTube URL", status: "201", body: "AnalyzeSourceRequest", result: schemaRef("ImportDraft"), description: "Runs yt-dlp and stores a one-hour import draft. Use the returned draft ID to create a source." },
  { path: "/api/sources", method: "get", operationId: "listSources", tag: "Sources", summary: "List configured sources", result: { type: "array", items: schemaRef("Source") } },
  { path: "/api/sources", method: "post", operationId: "createSource", tag: "Sources", summary: "Create a source from an analysis draft", status: "201", body: "CreateSourceRequest", result: schemaRef("Source") },
  { path: "/api/sources/{id}", method: "get", operationId: "getSource", tag: "Sources", summary: "Get a source and its videos", parameters: [sourceId], result: schemaRef("SourceDetail") },
  { path: "/api/sources/{id}", method: "patch", operationId: "updateSource", tag: "Sources", summary: "Update source settings", parameters: [sourceId], body: "UpdateSourceRequest", result: schemaRef("Source") },
  { path: "/api/sources/{id}", method: "delete", operationId: "deleteSource", tag: "Sources", summary: "Delete a source record", parameters: [sourceId], result: { type: "object", additionalProperties: true }, description: "Preserves downloaded media and does not delete remote Tunarr objects." },
  { path: "/api/sources/{id}/videos", method: "post", operationId: "addVideosToCollection", tag: "Sources", summary: "Add videos to a curated collection", status: "201", parameters: [sourceId], body: "AddCollectionVideosRequest", result: { type: "object", additionalProperties: true } },
  { path: "/api/sources/{id}/sync", method: "post", operationId: "syncSource", tag: "Sources", summary: "Queue a source synchronization", status: "202", parameters: [sourceId], result: schemaRef("Job") },
  { path: "/api/sources/{id}/tunarr", method: "post", operationId: "publishSourceToTunarr", tag: "Tunarr", summary: "Queue Tunarr channel publishing", status: "202", parameters: [sourceId], body: "PublishTunarrRequest", result: schemaRef("Job") },
  { path: "/api/sources/{id}/tunarr", method: "delete", operationId: "unlinkSourceFromTunarr", tag: "Tunarr", summary: "Forget the local Tunarr link", parameters: [sourceId], result: { type: "object", properties: { unlinked: { type: "boolean", const: true } } }, description: "Does not delete the remote Tunarr channel or media source." },
  { path: "/api/sources/{id}/tunarr/status", method: "get", operationId: "getTunarrLinkStatus", tag: "Tunarr", summary: "Inspect the source's Tunarr link", parameters: [sourceId], result: { type: "object", additionalProperties: true } },
  { path: "/api/sources/{id}/tunarr/reconcile", method: "post", operationId: "reconcileTunarrLink", tag: "Tunarr", summary: "Repair the source's Tunarr link", parameters: [sourceId], body: "ReconcileTunarrRequest", result: { type: "object", additionalProperties: true } },
  { path: "/api/videos", method: "get", operationId: "listVideos", tag: "Videos", summary: "List canonical videos", parameters: [queryParameter("sourceId", "Only videos belonging to this source.")], result: { type: "array", items: schemaRef("Video") } },
  { path: "/api/videos/{id}", method: "get", operationId: "getVideo", tag: "Videos", summary: "Get a canonical video", parameters: [pathParameter("id", "TunarrTube video ID (not the YouTube ID).")], result: schemaRef("Video") },
  { path: "/api/downloads", method: "post", operationId: "queueDownloads", tag: "Downloads", summary: "Queue permanent video downloads", status: "202", body: "QueueDownloadsRequest", result: { type: "array", items: schemaRef("Job") } },
  { path: "/api/jobs", method: "get", operationId: "listJobs", tag: "Jobs", summary: "List active and recent jobs", result: schemaRef("JobList") },
  { path: "/api/jobs", method: "patch", operationId: "setJobsPaused", tag: "Jobs", summary: "Pause or resume the job queue", body: "SetJobsPausedRequest", result: schemaRef("Settings"), description: "Pausing prevents new claims but does not interrupt a running job." },
  { path: "/api/jobs/{id}", method: "get", operationId: "getJob", tag: "Jobs", summary: "Get a job", parameters: [pathParameter("id", "Background job ID.")], result: schemaRef("Job") },
  { path: "/api/jobs/{id}", method: "patch", operationId: "mutateJob", tag: "Jobs", summary: "Cancel, stop, postpone, or retry a job", parameters: [pathParameter("id", "Background job ID.")], body: "JobMutationRequest", result: { type: "object", additionalProperties: true } },
  { path: "/api/playback/prepare", method: "post", operationId: "preparePlayback", tag: "Playback", summary: "Prepare a video for playback", status: "202", body: "PreparePlaybackRequest", result: schemaRef("PlaybackPreparation") },
  { path: "/api/cache", method: "get", operationId: "getCacheDashboard", tag: "Cache", summary: "Get cache usage and assets", result: { type: "object", additionalProperties: true } },
  { path: "/api/cache", method: "post", operationId: "enforceCachePolicy", tag: "Cache", summary: "Enforce limits or clear evictable cache entries", body: "CacheEnforceRequest", result: schemaRef("CacheEnforceResult") },
  { path: "/api/cache/{id}", method: "patch", operationId: "mutateCacheAsset", tag: "Cache", summary: "Pin, unpin, or evict a cache asset", parameters: [pathParameter("id", "Cache asset ID.")], body: "CacheMutationRequest", result: { type: "object", additionalProperties: true } },
  { path: "/api/settings", method: "get", operationId: "getSettings", tag: "Settings", summary: "Get application settings", result: schemaRef("Settings") },
  { path: "/api/settings", method: "patch", operationId: "updateSettings", tag: "Settings", summary: "Update application settings", body: "UpdateSettingsRequest", result: schemaRef("Settings") },
  { path: "/api/settings/path-preview", method: "get", operationId: "previewStoredPathMapping", tag: "Settings", summary: "Preview the stored Tunarr path mapping", parameters: [queryParameter("path", "Absolute path to translate.", true)], result: schemaRef("PathTranslation") },
  { path: "/api/settings/path-preview", method: "post", operationId: "previewPathMappings", tag: "Settings", summary: "Preview unsaved Tunarr path mappings", body: "PathPreviewRequest", result: schemaRef("PathTranslation") },
  { path: "/api/system/test-ytdlp", method: "post", operationId: "testYtDlp", tag: "System", summary: "Test yt-dlp discovery", result: schemaRef("BinaryStatus") },
  { path: "/api/system/update-ytdlp", method: "post", operationId: "updateYtDlp", tag: "System", summary: "Self-update the discovered yt-dlp binary", result: schemaRef("BinaryUpdateResult"), description: "Runs `yt-dlp --update`. Fails if yt-dlp was installed with a package manager that disables self-update; use that package manager instead." },
  { path: "/api/system/test-ffmpeg", method: "post", operationId: "testFfmpeg", tag: "System", summary: "Test FFmpeg discovery", result: schemaRef("BinaryStatus") },
  { path: "/api/system/test-tunarr", method: "post", operationId: "testTunarr", tag: "System", summary: "Test a Tunarr connection", body: "TestTunarrRequest", result: { type: "object", additionalProperties: true } },
  { path: "/api/system/repair-metadata", method: "post", operationId: "repairMetadata", tag: "System", summary: "Queue metadata sidecar repair", result: { type: "object", additionalProperties: true } },
  { path: "/api/logs", method: "get", operationId: "listLogs", tag: "Logs", summary: "List up to 500 recent sanitized logs", parameters: [queryParameter("category", "Only logs in this category.")], result: { type: "array", items: schemaRef("LogEntry") } },
  { path: "/api/logs", method: "post", operationId: "purgeLogs", tag: "Logs", summary: "Purge expired logs or clear all logs", body: "LogsPurgeRequest", result: { type: "object", additionalProperties: true } }
];

const binary = { type: "string", contentEncoding: "binary" };
operations.push(
  { path: "/api/playback/{sourceId}/{videoId}", method: "get", operationId: "streamPlayback", tag: "Playback", summary: "Stream a prepared video", parameters: [pathParameter("sourceId", "TunarrTube source ID."), pathParameter("videoId", "TunarrTube video ID."), { name: "Range", in: "header", required: false, schema: { type: "string" } }], rawResponses: { "200": { description: "Full MP4 stream.", content: { "video/mp4": { schema: binary } } }, "206": { description: "Partial MP4 stream.", content: { "video/mp4": { schema: binary } } }, ...errorResponses } },
  { path: "/api/playback/{sourceId}/{videoId}", method: "head", operationId: "headPlayback", tag: "Playback", summary: "Inspect a prepared video stream", parameters: [pathParameter("sourceId", "TunarrTube source ID."), pathParameter("videoId", "TunarrTube video ID.")], rawResponses: { "200": { description: "Playback headers." }, "206": { description: "Partial playback headers." }, ...errorResponses } },
  { path: "/api/thumbnails/{kind}/{id}", method: "get", operationId: "getThumbnail", tag: "Thumbnails", summary: "Get locally mirrored artwork", parameters: [{ name: "kind", in: "path", required: true, schema: { type: "string", enum: ["source", "video"] } }, pathParameter("id", "Source or video ID.")], rawResponses: { "200": { description: "Thumbnail image.", content: { "image/jpeg": { schema: binary }, "image/png": { schema: binary }, "image/webp": { schema: binary } } }, "304": { description: "Cached thumbnail is current." }, ...errorResponses } }
);

const paths: Record<string, JsonObject> = {};
for (const operation of operations) {
  const status = operation.status ?? "200";
  const operationObject = {
    tags: [operation.tag], operationId: operation.operationId, summary: operation.summary,
    ...(operation.description ? { description: operation.description } : {}),
    ...(operation.parameters ? { parameters: operation.parameters } : {}),
    ...(operation.body ? { requestBody: requestBody(operation.body) } : {}),
    responses: operation.rawResponses ?? { [status]: response("Successful response.", operation.result ?? {}), ...errorResponses }
  };
  paths[operation.path] = { ...paths[operation.path], [operation.method]: operationObject };
}

const nullableString = { type: ["string", "null"] };
const dateTime = { type: "string", format: "date-time" };
const videoQuality = { type: "string", enum: ["best", "2160p", "1440p", "1080p", "720p", "480p"] };
const pathMapping = { type: "object", required: ["ytarrPrefix", "tunarrPrefix"], properties: { ytarrPrefix: { type: "string", minLength: 1 }, tunarrPrefix: { type: "string", minLength: 1 } } };

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "TunarrTube API", version: "0.1.0", summary: "Control a local TunarrTube instance.",
    description: "This API has no built-in authentication and can start downloads, change filesystem settings, and mutate Tunarr. Keep it on a trusted network or behind an authenticated reverse proxy or VPN."
  },
  servers: [{ url: "/", description: "The TunarrTube server that served this document." }],
  security: [],
  tags: ["System", "Sources", "Videos", "Downloads", "Jobs", "Playback", "Cache", "Tunarr", "Settings", "Logs", "Thumbnails"].map((name) => ({ name })),
  paths,
  components: {
    responses: Object.fromEntries([
      ["BadRequest", "Invalid request."], ["Forbidden", "Cross-site browser request rejected."], ["NotFound", "Resource not found."],
      ["Conflict", "Resource state conflict."], ["UnprocessableEntity", "Request cannot be applied."], ["InternalError", "Unexpected server error."]
    ].map(([name, description]) => [name, { description, content: json(schemaRef("ErrorEnvelope")) }])),
    schemas: {
      ErrorEnvelope: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: {} } } } },
      Source: { type: "object", required: ["id", "name", "url", "sourceType", "youtubeId", "playbackMode", "syncEnabled"], additionalProperties: true, properties: { id: { type: "string" }, name: { type: "string" }, url: { type: "string", format: "uri" }, sourceType: { type: "string", enum: ["playlist", "channel", "collection"] }, youtubeId: { type: "string" }, playbackMode: { type: "string", enum: ["download", "cache", "stream"] }, videoQuality: { anyOf: [videoQuality, { type: "null" }] }, syncEnabled: { type: "boolean" }, syncIntervalMinutes: { type: "integer" }, createdAt: dateTime, updatedAt: dateTime } },
      SourceDetail: { allOf: [schemaRef("Source"), { type: "object", required: ["videos"], properties: { videos: { type: "array", items: { type: "object", additionalProperties: true } } } }] },
      Video: { type: "object", required: ["id", "youtubeId", "title", "youtubeUrl", "availability", "metadataStatus"], additionalProperties: true, properties: { id: { type: "string" }, youtubeId: { type: "string" }, title: { type: "string" }, description: nullableString, uploader: nullableString, durationSeconds: { type: ["integer", "null"] }, uploadDate: { anyOf: [dateTime, { type: "null" }] }, youtubeUrl: { type: "string", format: "uri" }, availability: { type: "string", enum: ["unknown", "available", "unavailable"] }, metadataStatus: { type: "string", enum: ["pending", "complete", "failed"] } } },
      Job: { type: "object", required: ["id", "type", "status", "attempts", "maxAttempts", "runAfter"], additionalProperties: true, properties: { id: { type: "string" }, type: { type: "string", enum: ["metadata", "thumbnail", "sync", "download", "cache", "retag", "tunarr_publish", "tunarr_refresh"] }, status: { type: "string", enum: ["queued", "running", "complete", "failed", "cancelled"] }, sourceId: nullableString, videoId: nullableString, attempts: { type: "integer" }, maxAttempts: { type: "integer" }, error: nullableString, runAfter: dateTime, stoppable: { type: "boolean" } } },
      JobList: { type: "object", required: ["paused", "running", "queued", "recent"], properties: { paused: { type: "boolean" }, running: { type: "array", items: schemaRef("Job") }, queued: { type: "array", items: schemaRef("Job") }, recent: { type: "array", items: schemaRef("Job") } } },
      Settings: { type: "object", required: ["id", "mediaBaseDirectory", "tunarrUrl", "cacheMaxMegabytes", "cacheMaxAgeDays", "logRetentionDays", "defaultVideoQuality", "jobsPaused"], additionalProperties: true, properties: { id: { type: "integer", const: 1 }, mediaBaseDirectory: { type: "string" }, tunarrUrl: { type: "string", format: "uri" }, cacheMaxMegabytes: { type: "integer" }, cacheMaxAgeDays: { type: "integer" }, logRetentionDays: { type: "integer" }, defaultVideoQuality: videoQuality, jobsPaused: { type: "boolean" }, pathMappings: { type: "array", items: pathMapping } } },
      ImportDraft: { type: "object", required: ["id", "name", "videoCount", "sourceType", "feedType", "expiresAt"], additionalProperties: true, properties: { id: { type: "string" }, name: { type: "string" }, videoCount: { type: "integer" }, sourceType: { type: "string" }, feedType: { type: "string" }, expiresAt: dateTime } },
      LogEntry: { type: "object", required: ["id", "level", "category", "message", "createdAt"], properties: { id: { type: "string" }, level: { type: "string" }, category: { type: "string" }, message: { type: "string" }, details: nullableString, sourceId: nullableString, videoId: nullableString, createdAt: dateTime } },
      Health: { type: "object", required: ["status", "database"], additionalProperties: true, properties: { status: { type: "string", enum: ["ready", "starting", "unhealthy"] }, database: { type: "string", enum: ["ok", "error"] } } },
      BinaryStatus: { type: "object", required: ["name", "found", "path", "version"], properties: { name: { type: "string", enum: ["yt-dlp", "ffmpeg"] }, found: { type: "boolean" }, path: nullableString, version: nullableString, error: { type: "string" } } },
      BinaryUpdateResult: { type: "object", required: ["name", "message", "version"], properties: { name: { type: "string", const: "yt-dlp" }, message: { type: "string" }, version: nullableString } },
      AnalyzeSourceRequest: { type: "object", required: ["url"], additionalProperties: false, properties: { url: { type: "string", format: "uri" }, feedType: { type: "string", enum: ["videos", "shorts", "live", "all"] }, historyLimit: { type: ["integer", "null"], minimum: 1, maximum: 5000 } } },
      CreateSourceRequest: { type: "object", required: ["draftId"], additionalProperties: false, properties: { draftId: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1, maxLength: 160 }, playbackMode: { type: "string", enum: ["download", "cache", "stream"], default: "download" }, videoQuality: { anyOf: [videoQuality, { type: "null" }] }, syncEnabled: { type: "boolean", default: false }, syncIntervalMinutes: { type: "integer", minimum: 15, maximum: 43200, default: 360 } } },
      UpdateSourceRequest: { type: "object", minProperties: 1, additionalProperties: false, properties: { name: { type: "string", minLength: 1, maxLength: 160 }, playbackMode: { type: "string", enum: ["download", "cache", "stream"] }, videoQuality: { anyOf: [videoQuality, { type: "null" }] }, syncEnabled: { type: "boolean" }, syncIntervalMinutes: { type: "integer", minimum: 15, maximum: 43200 } } },
      AddCollectionVideosRequest: { type: "object", required: ["urls"], additionalProperties: false, properties: { urls: { type: "array", minItems: 1, maxItems: 50, items: { type: "string", format: "uri" } } } },
      QueueDownloadsRequest: { type: "object", required: ["items"], additionalProperties: false, properties: { items: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", required: ["sourceId", "videoId"], properties: { sourceId: { type: "string", minLength: 1 }, videoId: { type: "string", minLength: 1 } } } } } },
      SetJobsPausedRequest: { type: "object", required: ["paused"], additionalProperties: false, properties: { paused: { type: "boolean" } } },
      JobMutationRequest: { type: "object", required: ["action"], additionalProperties: false, properties: { action: { type: "string", enum: ["cancel", "retry", "stop", "postpone"] }, postponeMinutes: { type: "integer", minimum: 1, maximum: 43200 } } },
      PreparePlaybackRequest: { type: "object", required: ["sourceId", "videoId"], additionalProperties: false, properties: { sourceId: { type: "string", minLength: 1 }, videoId: { type: "string", minLength: 1 } } },
      PlaybackPreparation: { type: "object", required: ["state", "playbackUrl"], properties: { state: { type: "string", enum: ["ready", "queued"] }, playbackUrl: { type: "string" }, jobId: { type: "string" } } },
      CacheEnforceRequest: { type: "object", additionalProperties: false, properties: { action: { type: "string", enum: ["enforce", "clear"], default: "enforce" } } },
      CacheMutationRequest: { type: "object", required: ["action"], additionalProperties: false, properties: { action: { type: "string", enum: ["pin", "unpin", "evict"] } } },
      CacheEnforceResult: { type: "object", required: ["evicted", "bytesRemaining", "limitBytes", "overLimit"], properties: { evicted: { type: "integer" }, bytesRemaining: { type: "string", pattern: "^[0-9]+$" }, limitBytes: { type: "string", pattern: "^[0-9]+$" }, overLimit: { type: "boolean" } } },
      UpdateSettingsRequest: { type: "object", minProperties: 1, additionalProperties: false, properties: { mediaBaseDirectory: { type: "string", minLength: 1 }, tunarrUrl: { type: "string", format: "uri" }, cacheMaxMegabytes: { type: "integer", minimum: 128, maximum: 10000000 }, cacheMaxAgeDays: { type: "integer", minimum: 1, maximum: 3650 }, logRetentionDays: { type: "integer", minimum: 1, maximum: 3650 }, defaultVideoQuality: videoQuality, pathMappings: { type: "array", maxItems: 50, items: pathMapping } } },
      PathPreviewRequest: { type: "object", required: ["path", "mappings"], properties: { path: { type: "string" }, mappings: { type: "array", items: pathMapping } } },
      PathTranslation: { type: "object", required: ["input", "output"], properties: { input: { type: "string" }, output: { type: "string" } } },
      PublishTunarrRequest: { type: "object", required: ["channelName"], additionalProperties: false, properties: { channelName: { type: "string", minLength: 1, maxLength: 160 }, channelNumber: { type: "integer", minimum: 1 }, programmingOrder: { type: "string", enum: ["playlist", "oldest", "newest", "random"], default: "playlist" } } },
      ReconcileTunarrRequest: { type: "object", additionalProperties: false, properties: { channelId: { type: "string", minLength: 1 } } },
      TestTunarrRequest: { type: "object", required: ["tunarrUrl"], additionalProperties: false, properties: { tunarrUrl: { type: "string", format: "uri" } } },
      LogsPurgeRequest: { type: "object", additionalProperties: false, properties: { action: { type: "string", enum: ["purge", "clear"], default: "purge" } } }
    }
  }
};

export type OpenApiDocument = typeof openApiDocument;
