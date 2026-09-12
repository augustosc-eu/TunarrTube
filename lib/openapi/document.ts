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
  { path: "/api/sources/{id}/videos/{videoId}", method: "delete", operationId: "removeVideoFromSource", tag: "Sources", summary: "Remove one video from a source", parameters: [sourceId, pathParameter("videoId", "TunarrTube video ID (not the YouTube ID).")], result: { type: "object", properties: { removed: { type: "boolean", const: true } } }, description: "Deletes the membership and any file it owns; the underlying video record is only deleted once no other source references it." },
  { path: "/api/sources/{id}/sync", method: "post", operationId: "syncSource", tag: "Sources", summary: "Queue a source synchronization", status: "202", parameters: [sourceId], result: schemaRef("Job") },
  { path: "/api/sources/{id}/tunarr", method: "post", operationId: "publishSourceToTunarr", tag: "Tunarr", summary: "Queue Tunarr channel publishing", status: "202", parameters: [sourceId], body: "PublishTunarrRequest", result: schemaRef("Job") },
  { path: "/api/sources/{id}/tunarr", method: "delete", operationId: "unlinkSourceFromTunarr", tag: "Tunarr", summary: "Forget the local Tunarr link", parameters: [sourceId], result: { type: "object", properties: { unlinked: { type: "boolean", const: true } } }, description: "Does not delete the remote Tunarr channel or media source." },
  { path: "/api/sources/{id}/tunarr/status", method: "get", operationId: "getTunarrLinkStatus", tag: "Tunarr", summary: "Inspect the source's Tunarr link", parameters: [sourceId], result: { type: "object", additionalProperties: true } },
  { path: "/api/sources/{id}/tunarr/reconcile", method: "post", operationId: "reconcileTunarrLink", tag: "Tunarr", summary: "Repair the source's Tunarr link", parameters: [sourceId], body: "ReconcileTunarrRequest", result: { type: "object", additionalProperties: true } },
  { path: "/api/videos", method: "get", operationId: "listVideos", tag: "Videos", summary: "List canonical videos", parameters: [queryParameter("sourceId", "Only videos belonging to this source.")], result: { type: "array", items: schemaRef("Video") } },
  { path: "/api/videos/{id}", method: "get", operationId: "getVideo", tag: "Videos", summary: "Get a canonical video", parameters: [pathParameter("id", "TunarrTube video ID (not the YouTube ID).")], result: schemaRef("Video") },
  { path: "/api/downloads", method: "post", operationId: "queueDownloads", tag: "Downloads", summary: "Queue permanent video downloads", status: "202", body: "QueueDownloadsRequest", result: { type: "array", items: schemaRef("Job") } },
  { path: "/api/jobs", method: "get", operationId: "listJobs", tag: "Jobs", summary: "List running, paginated queued, and recent jobs", parameters: [
    { name: "queuedPage", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
    { name: "pageSize", in: "query", schema: { type: "integer", minimum: 10, maximum: 100, default: 50 } }
  ], result: schemaRef("JobList") },
  { path: "/api/jobs", method: "patch", operationId: "setJobsPaused", tag: "Jobs", summary: "Pause or resume the job queue", body: "SetJobsPausedRequest", result: schemaRef("Settings"), description: "Pausing prevents new claims but does not interrupt a running job." },
  { path: "/api/jobs/status", method: "post", operationId: "getJobsStatus", tag: "Jobs", summary: "Get lightweight status for a batch of jobs", body: "JobStatusRequest", result: { type: "array", items: schemaRef("JobStatus") } },
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
  { path: "/api/settings/naming-preview", method: "post", operationId: "previewNamingScheme", tag: "Settings", summary: "Preview a naming scheme/template against a sample video", body: "NamingPreviewRequest", result: schemaRef("NamingPreview") },
  { path: "/api/system/test-ytdlp", method: "post", operationId: "testYtDlp", tag: "System", summary: "Test yt-dlp discovery", result: schemaRef("BinaryStatus") },
  { path: "/api/system/update-ytdlp", method: "post", operationId: "updateYtDlp", tag: "System", summary: "Self-update the discovered yt-dlp binary", result: schemaRef("BinaryUpdateResult"), description: "Runs `yt-dlp --update`. Fails if yt-dlp was installed with a package manager that disables self-update; use that package manager instead." },
  { path: "/api/system/test-ffmpeg", method: "post", operationId: "testFfmpeg", tag: "System", summary: "Test FFmpeg discovery", result: schemaRef("BinaryStatus") },
  { path: "/api/system/test-tunarr", method: "post", operationId: "testTunarr", tag: "System", summary: "Test a Tunarr connection", body: "TestTunarrRequest", result: { type: "object", additionalProperties: true } },
  { path: "/api/system/repair-metadata", method: "post", operationId: "repairMetadata", tag: "System", summary: "Queue metadata sidecar repair", result: { type: "object", additionalProperties: true } },
  { path: "/api/logs", method: "get", operationId: "listLogs", tag: "Logs", summary: "List up to 500 recent sanitized logs", parameters: [queryParameter("category", "Only logs in this category.")], result: { type: "array", items: schemaRef("LogEntry") } },
  { path: "/api/logs", method: "post", operationId: "purgeLogs", tag: "Logs", summary: "Purge expired logs or clear all logs", body: "LogsPurgeRequest", result: { type: "object", additionalProperties: true } }
];

// --- Channel-generator domain: curated, overlay-rendered channels ---------------------------------
const channelId = pathParameter("id", "Channel ID.");
const templateId = pathParameter("id", "Overlay template ID.");
const mediaItemId = pathParameter("id", "Media item ID.");
operations.push(
  { path: "/api/channels", method: "get", operationId: "listChannels", tag: "Channels", summary: "List curated overlay channels", result: { type: "array", items: schemaRef("Channel") } },
  { path: "/api/channels", method: "post", operationId: "createChannel", tag: "Channels", summary: "Create a curated overlay channel", status: "201", body: "CreateChannelRequest", result: schemaRef("Channel") },
  { path: "/api/channels/brief", method: "post", operationId: "createChannelFromBrief", tag: "Channels", summary: "Create a channel from a one-shot brief (AI selects content, renders, and publishes)", status: "202", body: "CreateChannelFromBriefRequest", result: { type: "object", additionalProperties: true }, description: "Queues a single channel_brief job: AI content selection from the given Sources, rendering every selected clip, then AI-scheduled Tunarr publishing." },
  { path: "/api/channels/{id}", method: "get", operationId: "getChannel", tag: "Channels", summary: "Get a channel and its curated items", parameters: [channelId], result: schemaRef("ChannelDetail") },
  { path: "/api/channels/{id}", method: "patch", operationId: "updateChannel", tag: "Channels", summary: "Update channel settings", parameters: [channelId], body: "UpdateChannelRequest", result: schemaRef("Channel") },
  { path: "/api/channels/{id}", method: "delete", operationId: "deleteChannel", tag: "Channels", summary: "Delete a channel record", parameters: [channelId], result: { type: "object", additionalProperties: true }, description: "Never deletes the channel's companion intake Source, downloaded media, or any remote Tunarr channel." },
  { path: "/api/channels/{id}/items", method: "post", operationId: "addChannelItem", tag: "Channels", summary: "Add a local folder, a YouTube URL, or an already-downloaded video to a channel", parameters: [channelId], body: "AddChannelItemRequest", result: { type: "object", additionalProperties: true } },
  { path: "/api/channels/{id}/items", method: "delete", operationId: "removeChannelItem", tag: "Channels", summary: "Remove a media item from a channel", parameters: [channelId], body: "RemoveChannelItemRequest", result: { type: "object", properties: { removed: { type: "boolean", const: true } } } },
  { path: "/api/channels/{id}/reorder", method: "post", operationId: "reorderChannelItems", tag: "Channels", summary: "Reorder a channel's curated items", parameters: [channelId], body: "ReorderChannelItemsRequest", result: { type: "object", properties: { reordered: { type: "boolean", const: true } } } },
  { path: "/api/channels/{id}/render", method: "post", operationId: "renderChannel", tag: "Channels", summary: "Queue rendering for every not-yet-rendered item", status: "202", parameters: [channelId], result: { type: "object", additionalProperties: true } },
  { path: "/api/channels/{id}/content-select", method: "post", operationId: "selectChannelContent", tag: "Channels", summary: "Queue AI selection of already-downloaded videos to add to a channel", status: "202", parameters: [channelId], body: "SelectChannelContentRequest", result: { type: "object", additionalProperties: true } },
  { path: "/api/channels/{id}/publish", method: "get", operationId: "getChannelTunarrLinkStatus", tag: "Tunarr", summary: "Inspect a channel's Tunarr link", parameters: [channelId], result: { type: "object", additionalProperties: true } },
  { path: "/api/channels/{id}/publish", method: "post", operationId: "publishChannelToTunarr", tag: "Tunarr", summary: "Queue Tunarr channel publishing for a curated channel", status: "202", parameters: [channelId], result: { type: "object", additionalProperties: true } },
  { path: "/api/channels/{id}/publish", method: "delete", operationId: "unlinkChannelFromTunarr", tag: "Tunarr", summary: "Forget a channel's local Tunarr link", parameters: [channelId], result: { type: "object", properties: { unlinked: { type: "boolean", const: true } } }, description: "Does not delete the remote Tunarr channel or media source." },
  { path: "/api/templates", method: "get", operationId: "listTemplates", tag: "Channels", summary: "List overlay templates, seeding the built-in ones", result: { type: "array", items: schemaRef("OverlayTemplate") } },
  { path: "/api/templates", method: "post", operationId: "createTemplate", tag: "Channels", summary: "Create an overlay template", status: "201", body: "CreateTemplateRequest", result: schemaRef("OverlayTemplate") },
  { path: "/api/templates/{id}", method: "get", operationId: "getTemplate", tag: "Channels", summary: "Get an overlay template", parameters: [templateId], result: schemaRef("OverlayTemplate") },
  { path: "/api/templates/{id}", method: "patch", operationId: "updateTemplate", tag: "Channels", summary: "Update an overlay template", parameters: [templateId], body: "UpdateTemplateRequest", result: schemaRef("OverlayTemplate") },
  { path: "/api/templates/{id}", method: "delete", operationId: "deleteTemplate", tag: "Channels", summary: "Delete an overlay template", parameters: [templateId], result: { type: "object", properties: { deleted: { type: "boolean", const: true } } }, description: "Fails if the template is built-in or still assigned to a channel." },
  { path: "/api/media-items/{id}", method: "get", operationId: "getMediaItem", tag: "Channels", summary: "Get a media item and its renders", parameters: [mediaItemId], result: schemaRef("MediaItem") },
  { path: "/api/media-items/{id}", method: "patch", operationId: "updateMediaItem", tag: "Channels", summary: "Manually edit a media item's metadata", parameters: [mediaItemId], body: "UpdateMediaItemRequest", result: schemaRef("MediaItem") },
  { path: "/api/media-items/{id}/render", method: "post", operationId: "renderMediaItem", tag: "Channels", summary: "Queue a single media item render", status: "202", parameters: [mediaItemId], body: "RenderMediaItemRequest", result: { type: "object", additionalProperties: true } },
  { path: "/api/media-items/{id}/metadata-search", method: "get", operationId: "searchMediaItemMetadata", tag: "Channels", summary: "Search MusicBrainz/iTunes for metadata candidates", parameters: [mediaItemId, queryParameter("title", "Title to search for (defaults to the item's own title)."), queryParameter("artist", "Artist to search for.")], result: { type: "array", items: schemaRef("MetadataCandidate") } },
  { path: "/api/media-items/{id}/metadata-apply", method: "post", operationId: "applyMediaItemMetadata", tag: "Channels", summary: "Apply a chosen metadata candidate", parameters: [mediaItemId], body: "MetadataCandidate", result: schemaRef("MediaItem") }
);

// --- Local Claude Code AI integration (lib/ai/, lib/programming/director.ts) -----------------------
operations.push(
  { path: "/api/ai/status", method: "get", operationId: "getAiStatus", tag: "AI", summary: "Check local Claude Code CLI availability", result: schemaRef("AiStatus"), description: "A cheap `claude --version` check only -- never runs a real prompt, and never fails the request even when Claude Code is missing or disabled." },
  { path: "/api/ai/test", method: "post", operationId: "testAiConnection", tag: "AI", summary: "Run a real Claude Code round-trip with a fixed test prompt", result: schemaRef("AiTestResult"), description: "Takes no request body -- always sends the same short, server-defined prompt, never text from the caller. Fails if Claude Code integration is disabled in Settings." },
  { path: "/api/channels/{id}/ai-director/preview", method: "post", operationId: "previewChannelAiSchedule", tag: "AI", summary: "AI Programming Director: preview a natural-language schedule request", parameters: [channelId], body: "DirectorPreviewRequest", result: schemaRef("DirectorPreviewResult"), description: "Generates and validates a schedule with the configured AI provider and returns a read-only preview -- never mutates the channel or Tunarr. Apply a previewed schedule with the existing PATCH /api/channels/{id} and POST /api/channels/{id}/publish, exactly like manually configuring AI Programming." }
);

const binary = { type: "string", contentEncoding: "binary" };
operations.push(
  { path: "/api/playback/{sourceId}/{videoId}", method: "get", operationId: "streamPlayback", tag: "Playback", summary: "Stream a prepared video", parameters: [pathParameter("sourceId", "TunarrTube source ID."), pathParameter("videoId", "TunarrTube video ID."), { name: "Range", in: "header", required: false, schema: { type: "string" } }], rawResponses: { "200": { description: "Full MP4 stream.", content: { "video/mp4": { schema: binary } } }, "206": { description: "Partial MP4 stream.", content: { "video/mp4": { schema: binary } } }, ...errorResponses } },
  { path: "/api/playback/{sourceId}/{videoId}", method: "head", operationId: "headPlayback", tag: "Playback", summary: "Inspect a prepared video stream", parameters: [pathParameter("sourceId", "TunarrTube source ID."), pathParameter("videoId", "TunarrTube video ID.")], rawResponses: { "200": { description: "Playback headers." }, "206": { description: "Partial playback headers." }, ...errorResponses } },
  { path: "/api/thumbnails/{kind}/{id}", method: "get", operationId: "getThumbnail", tag: "Thumbnails", summary: "Get locally mirrored artwork", parameters: [{ name: "kind", in: "path", required: true, schema: { type: "string", enum: ["source", "video", "render"] } }, pathParameter("id", "Source, video, or rendered-asset ID.")], rawResponses: { "200": { description: "Thumbnail image.", content: { "image/jpeg": { schema: binary }, "image/png": { schema: binary }, "image/webp": { schema: binary } } }, "304": { description: "Cached thumbnail is current." }, ...errorResponses } },
  { path: "/api/renders/{id}/video", method: "get", operationId: "streamRenderedAsset", tag: "Channels", summary: "Stream a completed rendered asset", parameters: [pathParameter("id", "Rendered asset ID."), { name: "Range", in: "header", required: false, schema: { type: "string" } }], rawResponses: { "200": { description: "Full MP4 stream.", content: { "video/mp4": { schema: binary } } }, "206": { description: "Partial MP4 stream.", content: { "video/mp4": { schema: binary } } }, ...errorResponses } },
  { path: "/api/renders/{id}/video", method: "head", operationId: "headRenderedAsset", tag: "Channels", summary: "Inspect a completed rendered asset stream", parameters: [pathParameter("id", "Rendered asset ID.")], rawResponses: { "200": { description: "Stream headers." }, "206": { description: "Partial stream headers." }, ...errorResponses } },
  { path: "/api/renders/{id}/reveal", method: "post", operationId: "revealRenderedAsset", tag: "Channels", summary: "Reveal a rendered asset's output file in the host file manager", parameters: [pathParameter("id", "Rendered asset ID.")], result: { type: "object", properties: { revealed: { type: "boolean", const: true } } }, description: "Runs the desktop's own \"reveal in file manager\" command (Finder/Explorer/xdg-open) on the local machine running TunarrTube." }
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
const namingScheme = { type: "string", enum: ["id", "template", "tvshow"] };
const pathMapping = { type: "object", required: ["ytarrPrefix", "tunarrPrefix"], properties: { ytarrPrefix: { type: "string", minLength: 1 }, tunarrPrefix: { type: "string", minLength: 1 } } };

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "TunarrTube API", version: "0.1.0", summary: "Control a local TunarrTube instance.",
    description: "This API has no built-in authentication and can start downloads, change filesystem settings, and mutate Tunarr. Keep it on a trusted network or behind an authenticated reverse proxy or VPN."
  },
  servers: [{ url: "/", description: "The TunarrTube server that served this document." }],
  security: [],
  tags: ["System", "Sources", "Videos", "Downloads", "Jobs", "Playback", "Cache", "Tunarr", "Settings", "Logs", "Thumbnails", "Channels", "AI"].map((name) => ({ name })),
  paths,
  components: {
    responses: Object.fromEntries([
      ["BadRequest", "Invalid request."], ["Forbidden", "Cross-site browser request rejected."], ["NotFound", "Resource not found."],
      ["Conflict", "Resource state conflict."], ["UnprocessableEntity", "Request cannot be applied."], ["InternalError", "Unexpected server error."]
    ].map(([name, description]) => [name, { description, content: json(schemaRef("ErrorEnvelope")) }])),
    schemas: {
      ErrorEnvelope: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: {} } } } },
      Source: { type: "object", required: ["id", "name", "url", "sourceType", "youtubeId", "playbackMode", "syncEnabled"], additionalProperties: true, properties: { id: { type: "string" }, name: { type: "string" }, url: { type: "string", format: "uri" }, sourceType: { type: "string", enum: ["playlist", "channel", "collection"] }, youtubeId: { type: "string" }, playbackMode: { type: "string", enum: ["download", "cache", "stream"] }, videoQuality: { anyOf: [videoQuality, { type: "null" }] }, namingScheme: { anyOf: [namingScheme, { type: "null" }] }, filenameTemplate: nullableString, syncEnabled: { type: "boolean" }, syncIntervalMinutes: { type: "integer" }, tunarrProgrammingOrder: { type: "string", enum: ["playlist", "oldest", "newest", "random", "ai"] }, aiProvider: nullableString, aiScheduleStyle: { anyOf: [{ type: "string", enum: ["daily-dayparts", "weekly-broadcast", "endless-rotation"] }, { type: "null" }] }, aiProgrammingInstructions: nullableString, createdAt: dateTime, updatedAt: dateTime } },
      SourceDetail: { allOf: [schemaRef("Source"), { type: "object", required: ["videos"], properties: { videos: { type: "array", items: { type: "object", additionalProperties: true } } } }] },
      Video: { type: "object", required: ["id", "youtubeId", "title", "youtubeUrl", "availability", "metadataStatus"], additionalProperties: true, properties: { id: { type: "string" }, youtubeId: { type: "string" }, title: { type: "string" }, description: nullableString, uploader: nullableString, artist: nullableString, album: nullableString, durationSeconds: { type: ["integer", "null"] }, uploadDate: { anyOf: [dateTime, { type: "null" }] }, youtubeUrl: { type: "string", format: "uri" }, availability: { type: "string", enum: ["unknown", "available", "unavailable"] }, metadataStatus: { type: "string", enum: ["pending", "complete", "failed"] } } },
      Job: { type: "object", required: ["id", "type", "status", "attempts", "maxAttempts", "runAfter"], additionalProperties: true, properties: { id: { type: "string" }, type: { type: "string", enum: ["metadata", "metadata_lookup", "thumbnail", "sync", "download", "cache", "retag", "tunarr_publish", "tunarr_refresh", "render", "ingest_local_scan", "channel_publish", "content_select", "channel_brief"] }, status: { type: "string", enum: ["queued", "running", "complete", "failed", "cancelled"] }, sourceId: nullableString, videoId: nullableString, channelId: nullableString, mediaItemId: nullableString, attempts: { type: "integer" }, maxAttempts: { type: "integer" }, error: nullableString, runAfter: dateTime, stoppable: { type: "boolean" } } },
      JobStatus: { type: "object", required: ["id", "status", "runAfter", "updatedAt"], properties: { id: { type: "string" }, status: { type: "string", enum: ["queued", "running", "complete", "failed", "cancelled"] }, error: nullableString, runAfter: dateTime, startedAt: { anyOf: [dateTime, { type: "null" }] }, finishedAt: { anyOf: [dateTime, { type: "null" }] }, updatedAt: dateTime } },
      JobList: { type: "object", required: ["paused", "running", "queued", "queuedPagination", "recent"], properties: { paused: { type: "boolean" }, running: { type: "array", items: schemaRef("Job") }, queued: { type: "array", items: schemaRef("Job") }, queuedPagination: { type: "object", required: ["page", "pageSize", "total", "totalPages"], properties: { page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } } }, recent: { type: "array", items: schemaRef("Job") } } },
      Settings: { type: "object", required: ["id", "mediaBaseDirectory", "tunarrUrl", "cacheMaxMegabytes", "cacheMaxAgeDays", "logRetentionDays", "defaultVideoQuality", "jobsPaused", "aiProvider"], additionalProperties: true, properties: { id: { type: "integer", const: 1 }, mediaBaseDirectory: { type: "string" }, tunarrUrl: { type: "string", format: "uri" }, cacheMaxMegabytes: { type: "integer" }, cacheMaxAgeDays: { type: "integer" }, logRetentionDays: { type: "integer" }, defaultVideoQuality: videoQuality, jobsPaused: { type: "boolean" }, musicbrainzContactEmail: nullableString, metadataMusicbrainzEnabled: { type: "boolean" }, metadataItunesEnabled: { type: "boolean" }, metadataAutoApplyThreshold: { type: "integer", minimum: 0, maximum: 100 }, aiProvider: { type: "string", enum: ["auto", "anthropic", "openai", "claude-code"] }, aiClaudeCodeEnabled: { type: "boolean" }, aiClaudeCodePath: nullableString, aiClaudeCodeTimeoutSeconds: { type: "integer", minimum: 10, maximum: 600 }, defaultNamingScheme: namingScheme, defaultFilenameTemplate: { type: "string" }, pathMappings: { type: "array", items: pathMapping } } },
      ImportDraft: { type: "object", required: ["id", "name", "videoCount", "sourceType", "feedType", "expiresAt"], additionalProperties: true, properties: { id: { type: "string" }, name: { type: "string" }, videoCount: { type: "integer" }, sourceType: { type: "string" }, feedType: { type: "string" }, expiresAt: dateTime } },
      LogEntry: { type: "object", required: ["id", "level", "category", "message", "createdAt"], properties: { id: { type: "string" }, level: { type: "string" }, category: { type: "string" }, message: { type: "string" }, details: nullableString, sourceId: nullableString, videoId: nullableString, createdAt: dateTime } },
      Health: { type: "object", required: ["status", "database"], additionalProperties: true, properties: { status: { type: "string", enum: ["ready", "starting", "unhealthy"] }, database: { type: "string", enum: ["ok", "error"] } } },
      BinaryStatus: { type: "object", required: ["name", "found", "path", "version"], properties: { name: { type: "string", enum: ["yt-dlp", "ffmpeg"] }, found: { type: "boolean" }, path: nullableString, version: nullableString, error: { type: "string" } } },
      BinaryUpdateResult: { type: "object", required: ["name", "message", "version", "updated"], properties: { name: { type: "string", const: "yt-dlp" }, message: { type: "string" }, version: nullableString, updated: { type: "boolean" } } },
      AnalyzeSourceRequest: { type: "object", required: ["url"], additionalProperties: false, properties: { url: { type: "string", format: "uri" }, feedType: { type: "string", enum: ["videos", "shorts", "live", "all"] }, historyLimit: { type: ["integer", "null"], minimum: 1, maximum: 5000 } } },
      CreateSourceRequest: { type: "object", required: ["draftId"], additionalProperties: false, properties: { draftId: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1, maxLength: 160 }, playbackMode: { type: "string", enum: ["download", "cache", "stream"], default: "download" }, videoQuality: { anyOf: [videoQuality, { type: "null" }] }, syncEnabled: { type: "boolean", default: false }, syncIntervalMinutes: { type: "integer", minimum: 15, maximum: 43200, default: 360 }, namingScheme: { anyOf: [namingScheme, { type: "null" }] }, filenameTemplate: { anyOf: [{ type: "string", minLength: 1, maxLength: 300 }, { type: "null" }] } } },
      UpdateSourceRequest: { type: "object", minProperties: 1, additionalProperties: false, properties: { name: { type: "string", minLength: 1, maxLength: 160 }, playbackMode: { type: "string", enum: ["download", "cache", "stream"] }, videoQuality: { anyOf: [videoQuality, { type: "null" }] }, syncEnabled: { type: "boolean" }, syncIntervalMinutes: { type: "integer", minimum: 15, maximum: 43200 }, namingScheme: { anyOf: [namingScheme, { type: "null" }] }, filenameTemplate: { anyOf: [{ type: "string", minLength: 1, maxLength: 300 }, { type: "null" }] } } },
      AddCollectionVideosRequest: { type: "object", required: ["urls"], additionalProperties: false, properties: { urls: { type: "array", minItems: 1, maxItems: 50, items: { type: "string", format: "uri" } } } },
      QueueDownloadsRequest: { type: "object", required: ["items"], additionalProperties: false, properties: { items: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", required: ["sourceId", "videoId"], properties: { sourceId: { type: "string", minLength: 1 }, videoId: { type: "string", minLength: 1 } } } } } },
      SetJobsPausedRequest: { type: "object", required: ["paused"], additionalProperties: false, properties: { paused: { type: "boolean" } } },
      JobStatusRequest: { type: "object", required: ["ids"], additionalProperties: false, properties: { ids: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: { type: "string", minLength: 1 } } } },
      JobMutationRequest: { type: "object", required: ["action"], additionalProperties: false, properties: { action: { type: "string", enum: ["cancel", "retry", "stop", "postpone"] }, postponeMinutes: { type: "integer", minimum: 1, maximum: 43200 } } },
      PreparePlaybackRequest: { type: "object", required: ["sourceId", "videoId"], additionalProperties: false, properties: { sourceId: { type: "string", minLength: 1 }, videoId: { type: "string", minLength: 1 } } },
      PlaybackPreparation: { type: "object", required: ["state", "playbackUrl"], properties: { state: { type: "string", enum: ["ready", "queued"] }, playbackUrl: { type: "string" }, jobId: { type: "string" } } },
      CacheEnforceRequest: { type: "object", additionalProperties: false, properties: { action: { type: "string", enum: ["enforce", "clear"], default: "enforce" } } },
      CacheMutationRequest: { type: "object", required: ["action"], additionalProperties: false, properties: { action: { type: "string", enum: ["pin", "unpin", "evict"] } } },
      CacheEnforceResult: { type: "object", required: ["evicted", "bytesRemaining", "limitBytes", "overLimit"], properties: { evicted: { type: "integer" }, bytesRemaining: { type: "string", pattern: "^[0-9]+$" }, limitBytes: { type: "string", pattern: "^[0-9]+$" }, overLimit: { type: "boolean" } } },
      UpdateSettingsRequest: { type: "object", minProperties: 1, additionalProperties: false, properties: { mediaBaseDirectory: { type: "string", minLength: 1 }, tunarrUrl: { type: "string", format: "uri" }, cacheMaxMegabytes: { type: "integer", minimum: 128, maximum: 10000000 }, cacheMaxAgeDays: { type: "integer", minimum: 1, maximum: 3650 }, logRetentionDays: { type: "integer", minimum: 1, maximum: 3650 }, defaultVideoQuality: videoQuality, musicbrainzContactEmail: { anyOf: [{ type: "string", format: "email" }, { type: "null" }] }, metadataMusicbrainzEnabled: { type: "boolean" }, metadataItunesEnabled: { type: "boolean" }, metadataAutoApplyThreshold: { type: "integer", minimum: 0, maximum: 100 }, aiProvider: { type: "string", enum: ["auto", "anthropic", "openai", "claude-code"] }, aiClaudeCodeEnabled: { type: "boolean" }, aiClaudeCodePath: nullableString, aiClaudeCodeTimeoutSeconds: { type: "integer", minimum: 10, maximum: 600 }, defaultNamingScheme: namingScheme, defaultFilenameTemplate: { type: "string", minLength: 1, maxLength: 300 }, pathMappings: { type: "array", maxItems: 50, items: pathMapping } } },
      PathPreviewRequest: { type: "object", required: ["path", "mappings"], properties: { path: { type: "string" }, mappings: { type: "array", items: pathMapping } } },
      PathTranslation: { type: "object", required: ["input", "output"], properties: { input: { type: "string" }, output: { type: "string" } } },
      NamingPreviewRequest: { type: "object", required: ["scheme"], additionalProperties: false, properties: { scheme: namingScheme, template: { type: "string" } } },
      NamingPreview: { type: "object", required: ["scheme", "template", "path", "showNfo"], properties: { scheme: namingScheme, template: { type: "string" }, path: { type: "string" }, showNfo: { type: "boolean" } } },
      PublishTunarrRequest: { type: "object", required: ["channelName"], additionalProperties: false, properties: { channelName: { type: "string", minLength: 1, maxLength: 160 }, channelNumber: { type: "integer", minimum: 1 }, programmingOrder: { type: "string", enum: ["playlist", "oldest", "newest", "random", "ai"], default: "playlist" }, aiInstructions: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] }, aiProvider: { anyOf: [{ type: "string", enum: ["anthropic", "openai", "claude-code"] }, { type: "null" }] }, aiScheduleStyle: { anyOf: [{ type: "string", enum: ["daily-dayparts", "weekly-broadcast", "endless-rotation"] }, { type: "null" }] } } },
      ReconcileTunarrRequest: { type: "object", additionalProperties: false, properties: { channelId: { type: "string", minLength: 1 } } },
      TestTunarrRequest: { type: "object", required: ["tunarrUrl"], additionalProperties: false, properties: { tunarrUrl: { type: "string", format: "uri" } } },
      LogsPurgeRequest: { type: "object", additionalProperties: false, properties: { action: { type: "string", enum: ["purge", "clear"], default: "purge" } } },

      // --- Channel-generator domain -----------------------------------------------------------
      Channel: { type: "object", required: ["id", "name", "channelType", "slug", "templateId", "storageDirectory", "programmingOrder"], additionalProperties: true, properties: { id: { type: "string" }, name: { type: "string" }, channelType: { type: "string" }, slug: { type: "string" }, templateId: { type: "string" }, storageDirectory: { type: "string" }, programmingOrder: { type: "string", enum: ["manual", "oldest", "newest", "random", "ai"] }, aiProvider: nullableString, aiScheduleStyle: { anyOf: [{ type: "string", enum: ["daily-dayparts", "weekly-broadcast", "endless-rotation"] }, { type: "null" }] }, aiProgrammingInstructions: nullableString, intakeSourceId: nullableString, tunarrChannelId: nullableString, tunarrChannelNumber: { type: ["integer", "null"] }, createdAt: dateTime, updatedAt: dateTime } },
      ChannelDetail: { allOf: [schemaRef("Channel"), { type: "object", required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: true } } } }] },
      OverlayTemplate: { type: "object", required: ["id", "name", "channelType", "htmlTemplate", "bindingsJson", "layersJson", "isBuiltIn"], additionalProperties: true, properties: { id: { type: "string" }, name: { type: "string" }, channelType: { type: "string" }, description: nullableString, htmlTemplate: { type: "string" }, bindingsJson: { type: "string" }, layersJson: { type: "string" }, visualLayoutJson: nullableString, isBuiltIn: { type: "boolean" }, createdAt: dateTime, updatedAt: dateTime } },
      MediaItem: { type: "object", required: ["id", "originType", "title", "metadataStatus"], additionalProperties: true, properties: { id: { type: "string" }, originType: { type: "string", enum: ["sourceVideo", "local"] }, sourceVideoId: nullableString, originLocalPath: nullableString, title: { type: "string" }, artist: nullableString, album: nullableString, year: { type: ["integer", "null"] }, genre: nullableString, durationSeconds: { type: ["integer", "null"] }, metadataStatus: { type: "string", enum: ["pending", "manual", "matched", "failed"] } } },
      MetadataCandidate: { type: "object", required: ["provider", "externalId", "title", "score"], additionalProperties: false, properties: { provider: { type: "string", enum: ["musicbrainz", "itunes"] }, externalId: { type: "string" }, title: { type: "string" }, artist: { type: "string" }, album: { type: "string" }, year: { type: "integer" }, releaseDate: { type: "string" }, artUrl: nullableString, score: { type: "number" } } },
      CreateChannelRequest: { type: "object", required: ["name", "templateId"], additionalProperties: false, properties: { name: { type: "string", minLength: 1, maxLength: 160 }, templateId: { type: "string", minLength: 1 } } },
      UpdateChannelRequest: { type: "object", minProperties: 1, additionalProperties: false, properties: { name: { type: "string", minLength: 1, maxLength: 160 }, templateId: { type: "string", minLength: 1 }, programmingOrder: { type: "string", enum: ["manual", "oldest", "newest", "random", "ai"] }, logoAssetPath: nullableString, tunarrRequestedChannelNumber: { type: ["integer", "null"], minimum: 1 }, aiProgrammingInstructions: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] }, aiProvider: { anyOf: [{ type: "string", enum: ["anthropic", "openai", "claude-code"] }, { type: "null" }] }, aiScheduleStyle: { anyOf: [{ type: "string", enum: ["daily-dayparts", "weekly-broadcast", "endless-rotation"] }, { type: "null" }] } } },
      SelectChannelContentRequest: { type: "object", required: ["sourceIds", "instructions"], additionalProperties: false, properties: { sourceIds: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1 } }, instructions: { type: "string", minLength: 1, maxLength: 4000 }, targetCount: { type: "integer", minimum: 1, maximum: 200 }, aiProvider: { anyOf: [{ type: "string", enum: ["anthropic", "openai", "claude-code"] }, { type: "null" }] } } },
      CreateChannelFromBriefRequest: { type: "object", required: ["name", "templateId", "brief", "sourceIds"], additionalProperties: false, properties: { name: { type: "string", minLength: 1, maxLength: 160 }, templateId: { type: "string", minLength: 1 }, brief: { type: "string", minLength: 1, maxLength: 4000 }, sourceIds: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1 } }, scheduleStyle: { anyOf: [{ type: "string", enum: ["daily-dayparts", "weekly-broadcast", "endless-rotation"] }, { type: "null" }] }, aiProvider: { anyOf: [{ type: "string", enum: ["anthropic", "openai", "claude-code"] }, { type: "null" }] } } },
      AddChannelItemRequest: { oneOf: [
        { type: "object", required: ["type", "folder"], additionalProperties: false, properties: { type: { type: "string", const: "local" }, folder: { type: "string", minLength: 1 } } },
        { type: "object", required: ["type", "url"], additionalProperties: false, properties: { type: { type: "string", const: "youtube" }, url: { type: "string", format: "uri" } } },
        { type: "object", required: ["type", "sourceVideoId"], additionalProperties: false, properties: { type: { type: "string", const: "existingVideo" }, sourceVideoId: { type: "string", minLength: 1 } } }
      ] },
      RemoveChannelItemRequest: { type: "object", required: ["mediaItemId"], additionalProperties: false, properties: { mediaItemId: { type: "string", minLength: 1 } } },
      ReorderChannelItemsRequest: { type: "object", required: ["mediaItemIds"], additionalProperties: false, properties: { mediaItemIds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } } } },
      CreateTemplateRequest: { type: "object", required: ["name", "htmlTemplate", "bindingsJson", "layersJson"], additionalProperties: false, properties: { name: { type: "string", minLength: 1, maxLength: 160 }, channelType: { type: "string", minLength: 1, maxLength: 60, default: "music_video" }, description: { type: "string", maxLength: 500 }, htmlTemplate: { type: "string", minLength: 1 }, bindingsJson: { type: "string", minLength: 1 }, layersJson: { type: "string", minLength: 1 }, visualLayoutJson: nullableString } },
      UpdateTemplateRequest: { type: "object", minProperties: 1, additionalProperties: false, properties: { name: { type: "string", minLength: 1, maxLength: 160 }, channelType: { type: "string", minLength: 1, maxLength: 60 }, description: { type: "string", maxLength: 500 }, htmlTemplate: { type: "string", minLength: 1 }, bindingsJson: { type: "string", minLength: 1 }, layersJson: { type: "string", minLength: 1 }, visualLayoutJson: nullableString } },
      UpdateMediaItemRequest: { type: "object", minProperties: 1, additionalProperties: false, properties: { title: { type: "string", minLength: 1, maxLength: 300 }, artist: nullableString, album: nullableString, year: { type: ["integer", "null"], minimum: 1900, maximum: 2100 }, genre: nullableString, releaseDate: nullableString, customFieldsJson: nullableString } },
      RenderMediaItemRequest: { type: "object", required: ["templateId"], additionalProperties: false, properties: { templateId: { type: "string", minLength: 1 } } },

      // --- Local Claude Code AI integration -----------------------------------------------------
      AiStatus: { type: "object", required: ["available", "detail", "enabled", "timeoutSeconds"], properties: { available: { type: "boolean" }, detail: { type: "string" }, version: nullableString, path: nullableString, enabled: { type: "boolean" }, timeoutSeconds: { type: "integer" }, executablePathOverride: nullableString } },
      AiTestResult: { type: "object", required: ["ok", "latencyMs", "sample"], properties: { ok: { type: "boolean", const: true }, latencyMs: { type: "integer" }, sample: { type: "string" }, costUsd: { type: ["number", "null"] } } },
      DirectorPreviewRequest: { type: "object", required: ["instructions", "scheduleStyle"], additionalProperties: false, properties: { instructions: { type: "string", minLength: 1, maxLength: 4000 }, scheduleStyle: { type: "string", enum: ["daily-dayparts", "weekly-broadcast", "endless-rotation"] }, aiProvider: { anyOf: [{ type: "string", enum: ["anthropic", "openai", "claude-code"] }, { type: "null" }] } } },
      DirectorPreviewResult: { type: "object", required: ["provider", "kind", "period", "totalCandidateCount", "usedCandidateCount", "unusedCandidateCount", "warnings", "plan"], properties: { provider: { type: "string" }, kind: { type: "string", enum: ["dayparts", "rotation"] }, period: { type: "string", enum: ["day", "week"] }, blocks: { type: ["array", "null"], items: { type: "object", additionalProperties: true } }, groups: { type: ["array", "null"], items: { type: "object", additionalProperties: true } }, totalCandidateCount: { type: "integer" }, usedCandidateCount: { type: "integer" }, unusedCandidateCount: { type: "integer" }, warnings: { type: "array", items: { type: "string" } }, plan: { type: "object", additionalProperties: true } } }
    }
  }
};

export type OpenApiDocument = typeof openApiDocument;
