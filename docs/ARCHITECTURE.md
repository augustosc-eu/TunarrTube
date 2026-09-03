# YTarr — Architecture

This document describes the architecture that actually exists in this repository, traced from real execution paths and file contents as of this writing. File and symbol references are exact. Where something could not be verified from the code, it is marked as such rather than assumed.

## Application structure

```
app/                     Next.js App Router
  api/**/route.ts         API route handlers (REST-ish JSON)
  <page routes>/page.tsx   Server Component pages
  layout.tsx, error.tsx, not-found.tsx, globals.css
components/              Client ("use client") React components
lib/                     Domain services — the actual application logic
  api.ts                  AppError, ok(), toErrorResponse(), serialize()
  db/client.ts             Prisma client singleton
  validation.ts             zod schemas for API input
  sources/, downloads/, jobs/, tunarr/, cache/, playback/,
  settings/, metadata/, thumbnails/, youtube/, system/, logging/
prisma/                  schema.prisma, committed migrations, ytarr.db (dev)
storage/                 Default local media/ and thumbnails/ roots
scripts/prepare-dev.mjs  Pre-dev/pre-start: ensures DB file, runs prisma generate + migrate deploy
tests/                   vitest tests against lib/ modules
instrumentation.ts       Next.js server-boot hook: starts the job worker + scheduler
next.config.ts, Dockerfile, compose.yaml
```

Every domain in `lib/` follows the same shape: a `service.ts` (sometimes plus `client.ts`/`types.ts`) exporting plain async functions that take/return domain data and throw `AppError` on failure. Route handlers under `app/api/**/route.ts` are thin adapters: parse (zod), call the service, return `ok(...)`/`toErrorResponse(...)`.

## Frameworks and major dependencies

From [package.json](../package.json):

- **Next.js 16.3.4** — App Router, Server Components for all pages, `output: "standalone"` build.
- **React 19.2.4** / **react-dom 19.2.4**.
- **Prisma 6.12.0** (`@prisma/client`) with the **SQLite** provider — the only datastore.
- **Zod 4.3.6** — all API input validation (`lib/validation.ts`).
- **Tailwind CSS 4.1.18** via `@tailwindcss/postcss` — used for `app/globals.css` (no component-level utility classes observed; hand-written class names like `card`, `toolbar`, `badge` are styled in `globals.css`).
- **lucide-react 0.468.0** — icon set used throughout `components/`.
- **Vitest 4.1.11** — the only test runner; no `@testing-library/*` or component-testing dependency is present.
- No client-side state management library (no Redux/Zustand/React Query/SWR). Client components use `useState` plus direct `fetch` calls against `app/api/**`, and `next/navigation`'s `useRouter().refresh()` to re-pull server-rendered data after a mutation.

## Entry points

- **`instrumentation.ts`** — Next.js's `register()` server-boot hook. Guarded by `process.env.NEXT_RUNTIME === "nodejs"` and skipped during `NEXT_PHASE === "phase-production-build"`. On a real server start it dynamically imports and calls `kickWorker()` (`lib/jobs/runner.ts`) and `startScheduler()` (`lib/jobs/scheduler.ts`). `startScheduler()` is only ever called here (it no-ops on a second call via a `globalThis` guard). `kickWorker()` is additionally called after every job-enqueueing service call (`lib/sources/service.ts`, `lib/jobs/service.ts`, `lib/playback/service.ts`, `lib/tunarr/service.ts`, `app/api/sources/[id]/route.ts`) to wake the worker promptly instead of waiting for its self-scheduled timer; it is idempotent (a no-op if the worker loop is already running).
- **`scripts/prepare-dev.mjs`** — run by the `predev` and `prestart` npm scripts. Loads `.env` if present, ensures the SQLite file's parent directory and file exist, then runs `prisma generate` and `prisma migrate deploy` via `node_modules/.bin/prisma`, exiting non-zero on failure.
- **`app/layout.tsx`** — root layout; renders `Sidebar` plus `{children}` inside a `.shell` div. Sets the `<title>` template (`"%s · YTarr"`).
- **Docker container** — `Dockerfile`'s `CMD` runs `node node_modules/prisma/build/index.js migrate deploy && node server.js`, i.e. migrations are applied, then the Next.js standalone server (`server.js`, produced by `output: "standalone"`) starts, which in turn triggers `instrumentation.ts`.

## Routing

Next.js App Router, file-system based. All data-driven pages set `export const dynamic = "force-dynamic"` (they read the database directly and must not be statically cached).

**Pages** (`app/**/page.tsx`):
| Route | File | Purpose |
|---|---|---|
| `/` | `app/page.tsx` | Dashboard: counts + recent sources |
| `/sources` | `app/sources/page.tsx` | List all sources |
| `/sources/new` | `app/sources/new/page.tsx` | Analyze + create a source |
| `/sources/[id]` | `app/sources/[id]/page.tsx` | Source detail: videos, settings, Tunarr panel |
| `/videos` | `app/videos/page.tsx` | Canonical cross-source video library |
| `/cache` | `app/cache/page.tsx` | Cache dashboard |
| `/logs` | `app/logs/page.tsx` | Operational log viewer (filterable by `?category=`) |
| `/settings` | `app/settings/page.tsx` | App configuration |

`app/error.tsx` (client error boundary) and `app/not-found.tsx` provide the error/404 UI.

**API routes** (`app/api/**/route.ts`), all returning `{ data }` or `{ error: { code, message, details? } }`:

| Method & path | Handler | Service call |
|---|---|---|
| `GET/POST /api/sources` | `listSources` / `createSourceFromDraft` | `lib/sources/service.ts` |
| `POST /api/sources/analyze` | `analyzeAndStoreDraft` | `lib/sources/service.ts` |
| `GET/PATCH/DELETE /api/sources/[id]` | `getSource` / inline `db.source.update` / `deleteSource` | `lib/sources/service.ts` |
| `POST /api/sources/[id]/sync` | `enqueueSync` | `lib/sources/service.ts` |
| `POST/DELETE /api/sources/[id]/tunarr` | `enqueueTunarrPublish` / `unlinkTunarr` | `lib/tunarr/service.ts` |
| `GET /api/sources/[id]/tunarr/status` | `tunarrLinkStatus` | `lib/tunarr/service.ts` |
| `POST /api/sources/[id]/tunarr/reconcile` | `reconcileTunarrLink` | `lib/tunarr/service.ts` |
| `POST /api/downloads` | `enqueueDownloads` | `lib/jobs/service.ts` |
| `GET /api/videos` | inline Prisma query (`?sourceId=` filter) | `lib/db/client.ts` |
| `GET /api/videos/[id]` | inline Prisma query | `lib/db/client.ts` |
| `GET /api/jobs/[id]` | `getJob` | `lib/jobs/service.ts` |
| `GET/POST /api/cache` | `cacheDashboard` / `enforceCachePolicy` | `lib/cache/service.ts` |
| `PATCH /api/cache/[id]` | `mutateCacheAsset` (pin/unpin/evict) | `lib/cache/service.ts` |
| `POST /api/playback/prepare` | `preparePlayback` | `lib/playback/service.ts` |
| `GET/HEAD /api/playback/[sourceId]/[videoId]` | `playbackResponse` | `lib/playback/service.ts` (streams file or proxies live YouTube URL) |
| `GET/PATCH /api/settings` | `getSettingsView` / `updateSettings` | `lib/settings/service.ts` |
| `GET/POST /api/settings/path-preview` | `translatePathForTunarr` / `translatePathWithMappings` | `lib/settings/service.ts` |
| `POST /api/system/test-ytdlp`, `/test-ffmpeg` | `inspectBinary` | `lib/system/binaries.ts` |
| `POST /api/system/test-tunarr` | `testTunarrConnection` | `lib/tunarr/service.ts` |
| `GET /api/thumbnails/[kind]/[id]` | `thumbnailResponse` | `lib/thumbnails/service.ts` |
| `GET /api/logs` | inline Prisma query (`?category=`, capped at 500) | `lib/db/client.ts` |
| `GET /api/health` | inline: `SELECT 1` + `schedulerStatus()` | `lib/jobs/scheduler.ts` — used by the Docker `HEALTHCHECK` |

Dynamic segments use the Next.js 16 async `params: Promise<{...}>` convention throughout (`const { id } = await params`).

## State management

There is no client-side global state store. The pattern, consistent across every component in `components/`:

1. A Server Component page fetches its own data directly via Prisma (`db.*`) or a `lib/` service function, and passes plain serializable props to a client component.
2. Client components (`"use client"`) hold interaction state in `useState` (form fields, busy/loading flags, error/status messages).
3. Mutating actions `fetch()` an `/api/**` route directly, unwrap `{ data }` / throw on `{ error }` (each component repeats a small local `data(response)`/`message(response)` helper doing this), then call `router.refresh()` (from `next/navigation`) to re-run the Server Component and pick up fresh data.
4. Long-running actions (sync, download, Tunarr publish, playback preparation) poll `GET /api/jobs/[id]` on a `setTimeout` loop client-side until the job reaches `complete`/`failed`/`cancelled`, updating a status message as they go (see `components/source-actions.tsx`, `components/tunarr-channel-form.tsx`, `components/video-selection-table.tsx`).

Server-side "state" (in the sense of process-lifetime singletons) is kept on `globalThis` specifically to survive Next.js dev-mode module reloads:
- `lib/db/client.ts` — the Prisma client singleton.
- `lib/jobs/runner.ts` — `ytarrWorker` (the in-flight worker promise), `ytarrRecovered`, `ytarrWakeTimer`.
- `lib/jobs/scheduler.ts` — `ytarrSchedulerTimer`, `ytarrCacheTimer`, `ytarrSchedulerStartedAt`, `ytarrSchedulerRunning`.

## Important components

All under `components/`. Most are `"use client"`; three (`sidebar.tsx`, `page-header.tsx`, `source-card.tsx`) have no client directive and render as Server Components — they're static/presentational and take no interactive state:

- **`sidebar.tsx`** *(server)* — static top-level navigation (Dashboard/Sources/Videos/Cache/Logs/Settings).
- **`page-header.tsx`** *(server)* — trivial `{eyebrow, title, action}` header, reused by every page.
- **`source-card.tsx`** *(server)* — source summary tile (thumbnail, type, video count, playback mode, last synced) linking to the source detail page.
- **`add-source-form.tsx`** *(client)* — two-step flow: analyze a URL into a `Draft`, then configure name/playback mode/sync and create the source.
- **`source-actions.tsx`** *(client)* — Sync Now / Delete buttons on the source detail page; polls the resulting sync job.
- **`source-settings.tsx`** *(client)* — edits a source's `playbackMode` and sync enable/interval via `PATCH /api/sources/[id]`.
- **`tunarr-channel-form.tsx`** *(client)* — the Tunarr publish/reconcile/unlink UI; polls the `tunarr_publish` job and surfaces reconciliation candidates when a stored channel link is stale.
- **`video-selection-table.tsx`** *(client)* — per-video table with select/download-selected, per-row play (inline `<video>` player), and status badges (metadata/download/availability).
- **`cache-dashboard.tsx`** *(client)* — cache usage stats, per-asset pin/unpin/evict/play, and "enforce limits"/"clear evictable" actions.
- **`settings-form.tsx`** *(client)* — media directory, `yt-dlp`/FFmpeg detection, Tunarr URL + connectivity test, cache limits, and the path-mapping editor with live preview.

## Important services (`lib/`)

- **`sources/service.ts`** — the core domain: `analyzeAndStoreDraft`, `createSourceFromDraft`, `listSources`, `getSource`, `syncSource`, `deleteSource`, `enqueueUniqueJob` (dedupes queued/running jobs by type+source+video), `enqueueSync`. `slugify` derives each source's on-disk `directoryName`.
- **`downloads/service.ts`** — `downloadVideo` (permanent download via `yt-dlp`+FFmpeg into the source's directory, with hardlink/copy reuse of an identical file already downloaded for another source via `reuseExistingAsset`), `cacheVideo` (same download machinery, targeting the shared cache directory), `materializeForTunarr` (promotes a cache/stream video to a real file in the source directory so Tunarr can scan it), `touchCacheAsset`.
- **`jobs/runner.ts`** — the single background worker: `recoverJobs()` requeues anything left `running`/`downloading` from a previous crash; `claimJob()` atomically claims the oldest due `queued` job (`updateMany` with a `status: "queued"` guard, `attempts: increment`); `handleJob()` dispatches by `job.type` to the relevant service function; `work()` loops until no jobs remain, retries failures with capped exponential backoff (`min(60, 2^attempts * 2)` seconds) up to `job.maxAttempts` (3, except `tunarr_refresh` = 100), and re-enqueues a `tunarr_refresh` job after any `download`/`cache` job completes for a source with a linked Tunarr channel. `kickWorker()` starts/wakes the loop and self-schedules a wake timer for the next due job.
- **`jobs/scheduler.ts`** — `runDueSyncs()` finds sources with `syncEnabled` and a due `nextSyncAt`, updates `nextSyncAt`, and enqueues a `sync` job for each; `startScheduler()` runs it once immediately, then every 60s via `setInterval`, plus an hourly `enforceCachePolicy()` and a one-time `reconcileCacheFiles()` at boot.
- **`jobs/service.ts`** — `enqueueDownloads` (bulk, validates membership, skips already-complete), `getJob`.
- **`tunarr/client.ts`** — `TunarrApiClient`: thin typed wrapper over the Tunarr HTTP API (`/openapi.json`, `/api/version`, `/api/system/health`, `/api/media-sources`, `/api/media-sources/{id}/libraries/{id}/scan`, `/api/media-sources/{id}/{libraryId}/status`, `/api/media-libraries/{id}/programs`, `/api/channels`, `/api/channels/{id}`, `/api/channels/{id}/programming`, `/api/transcode_configs`). `discover()` checks that every required (path, method) pair is present in the target server's OpenAPI document before anything is allowed to mutate.
- **`tunarr/service.ts`** — `publishSourceToTunarr` (the full publish flow: prefetch if needed → ensure local media source/library → scan → wait for scan → list programs → match by filename via `mapPrograms` → order via `orderMemberships` → create/update channel → replace programming), `tunarrLinkStatus`, `reconcileTunarrLink`, `unlinkTunarr` (deletes only locally-materialized `retentionOrigin: "tunarr"` files, never the remote Tunarr channel), `testTunarrConnection`, `enqueueTunarrPublish`.
- **`cache/service.ts`** — `enforceCachePolicy` (evicts complete, unpinned, non-active, non-Tunarr-protected assets, oldest-accessed first, until under the configured byte limit and idle-age cutoff — a 5-minute grace period protects freshly-cached assets from immediate eviction), `cacheDashboard`, `mutateCacheAsset`, `reconcileCacheFiles` (marks DB rows `not_cached` if their file is missing on disk), `protectedVideoIds` (videos required by a linked Tunarr channel).
- **`playback/service.ts`** — `preparePlayback` (returns `ready` immediately if a local file exists or the source streams; otherwise enqueues a `download`/`cache` job and returns `queued`), `playbackResponse` (HTTP range-request file streaming for local files via `createReadStream`; live proxy to a resolved YouTube CDN URL for `stream`-mode sources with no local file, forwarding the `Range` header), `parseRange` (RFC 7233 `bytes=` parsing).
- **`settings/service.ts`** — `getSettings`/`getSettingsView` (the singleton `AppSettings` row, `id: 1`, self-healing if its directory was moved externally), `updateSettings` (validates and moves future source destinations to a new media root; existing completed files are **not** moved), `normalizeTunarrUrl`, `translatePathWithMappings`/`translatePathForTunarr` (longest-prefix path translation for the Tunarr integration), `assertWithinDirectory` (path-traversal guard used before every filesystem write derived from user/DB data), `validateMediaDirectory`.
- **`metadata/service.ts`** — `enrichVideo`: background job that re-fetches full `yt-dlp` metadata for a video and marks it `metadataStatus: "complete"`/`"failed"`, or `availability: "unavailable"` if the error text matches private/unavailable/deleted/removed.
- **`thumbnails/service.ts`** — `persistSourceThumbnails` (mirrors a source's and its videos' remote thumbnails to local disk under `storage/thumbnails/{sources,videos}/`, allow-listing only YouTube/Google image hosts), `thumbnailResponse` (serves the local file with ETag/cache headers), `removeSourceThumbnail`.
- **`youtube/ytdlp.ts`** — all `yt-dlp` invocations: `analyzePlaylist`, `analyzeChannelFeed`/`analyzeSource` (merges videos/shorts/live when `feedType: "all"`), `fetchVideoMetadata`, `resolveStreamUrl` (validates the resolved URL is actually a `youtube.com`/`googlevideo.com` HTTPS host before returning it).
- **`youtube/normalize.ts`** — turns raw `yt-dlp` JSON into typed `PlaylistEntry`/`PlaylistAnalysis`, including the specific error (`YTDLP_PLAYLIST_INCOMPLETE` vs `EMPTY_PLAYLIST`) when a playlist reports items but extracts none — a known outdated-`yt-dlp` failure mode called out in the README.
- **`youtube/url.ts`** — `validateSourceUrl`/`validatePlaylistUrl`: the host/URL allow-list gate for all source URLs.
- **`system/binaries.ts`** — `discoverBinary` (env override → `which` → hardcoded Homebrew/Linux fallback paths), `inspectBinary` (runs `--version`/`-version` for the Settings page "Test" buttons).
- **`system/process.ts`** — `runProcess`: the single `child_process.spawn` wrapper used for every external process (`yt-dlp`, FFmpeg, `which`), with timeout, abort-signal, and output-size capping (25 MB) and log sanitization on failure messages.
- **`logging/service.ts`** — `writeLog` (persists a `LogEntry`), `sanitizeLogValue` (redacts signed googlevideo/youtube URLs and `--cookies[-from-browser]` flags — used both here and in `system/process.ts`).
- **`db/client.ts`** — the Prisma client singleton, cached on `globalThis` outside production.
- **`api.ts`** — `AppError`, `ok()`, `toErrorResponse()` (maps `AppError` → its status/code, `ZodError` → 400 `VALIDATION_ERROR`, anything else → 500 `INTERNAL_ERROR` after `console.error`), `serialize()` (BigInt-safe JSON round-trip).
- **`validation.ts`** — every zod schema used at an API boundary.

## API structure

Every route follows the same envelope, defined once in `lib/api.ts`:
- Success: `Response.json({ data }, init)` via `ok()`.
- Failure: `Response.json({ error: { code, message, details? } }, { status })` via `toErrorResponse()`, called from a `catch` block in essentially every handler.
- `AppError` carries a machine-readable `code`, a human message, an HTTP status, and optional `details`.
- Responses containing Prisma `BigInt` fields (`fileSize`) are passed through `serialize()` first.
- Playback and thumbnail routes return raw `Response`/`ReadableStream` objects instead of the JSON envelope, since they serve binary media.

## External integrations

1. **`yt-dlp`** — invoked exclusively via `lib/system/process.ts:runProcess`, wrapped by `lib/youtube/ytdlp.ts`. Used for: playlist/channel analysis (`--dump-single-json --flat-playlist`), single-video metadata refresh, permanent video download (`-f bv*[vcodec^=avc]+ba[acodec^=mp4a]/b[ext=mp4]/best --merge-output-format mp4 --recode-video mp4`, via `--ffmpeg-location`), and resolving a direct stream URL for `stream`-mode playback (`--get-url`). Binary location is resolved by `lib/system/binaries.ts:discoverBinary` (env override → `which` → fallback paths).
2. **FFmpeg** — not invoked directly by YTarr; only located (`discoverBinary("ffmpeg")`) and its directory passed to `yt-dlp --ffmpeg-location` so `yt-dlp` can remux/recode.
3. **Tunarr HTTP API** — `lib/tunarr/client.ts`. Capability-discovered via `/openapi.json` before any mutating call. Consumes `/api/media-sources`, channel scan/status, `/api/media-libraries/{id}/programs`, `/api/channels`, `/api/transcode_configs`. No API key/auth header is sent — the integration assumes an unauthenticated (or network-trusted) local Tunarr instance.
4. **Remote thumbnail hosts** — `i.ytimg.com`, `img.youtube.com`, `yt3.ggpht.com`, `*.googleusercontent.com` (allow-listed in `next.config.ts` for `next/image`, and independently in `lib/thumbnails/service.ts`'s `ALLOWED_HOSTS` for the server-side mirroring fetch).
5. **Live YouTube CDN** — for `stream`-mode playback, `playbackResponse` proxies a `googlevideo.com`/`youtube.com` URL resolved just-in-time by `resolveStreamUrl`, forwarding `Range` and streaming the upstream body straight through.

## Persistence

SQLite via Prisma ([prisma/schema.prisma](../prisma/schema.prisma)). Dev default file: `prisma/ytarr.db` (`DATABASE_URL="file:./ytarr.db"`); Docker default: `/config/ytarr.db`. Models:

- **`Source`** — one configured playlist/channel. Unique on `(sourceType, youtubeId, feedType)` and on `directoryName`. Carries playback mode, sync config (`syncEnabled`, `syncIntervalMinutes`, `nextSyncAt`, `lastSyncedAt`, `lastSyncStatus`), and the full set of `tunarr*` linkage fields (`tunarrMediaSourceId`, `tunarrLibraryId`, `tunarrChannelId`, `tunarrChannelNumber`, `tunarrLastPublishedAt`, `tunarrChannelName`, `tunarrRequestedChannelNumber`, `tunarrProgrammingOrder`).
- **`Video`** — canonical, deduplicated by `youtubeId` (unique). Carries `metadataStatus` (`pending`/`complete`/`failed`) and `availability` (`unknown`/`available`/`unavailable`).
- **`SourceVideo`** — join table, unique on `(sourceId, videoId)`. Per-source-per-video state: `playlistIndex`, `membershipStatus` (`present`/`missing`), `downloadStatus` (`not_downloaded`/`queued`/`downloading`/`complete`/`failed`), `localPath`, `fileSize` (`BigInt`), `retentionOrigin` (`none`/`permanent`/`tunarr`).
- **`ImportDraft`** — ephemeral analysis result; `expiresAt` (1h from creation) and `consumedAt` gate reuse; indexed on `expiresAt` for cleanup.
- **`Job`** — the generic work queue: `type`, `status` (`queued`/`running`/`complete`/`failed`/`cancelled`), `sourceId`/`videoId` (optional FKs, `onDelete: Cascade`), `payloadJson`, `attempts`/`maxAttempts`, `error`, `runAfter` (backoff/scheduling), timestamps. Indexed for the worker's claim query and for `enqueueUniqueJob`'s dedupe lookup.
- **`AppSettings`** — singleton, `id` pinned to `1`: `mediaBaseDirectory`, `tunarrUrl`, `cacheMaxMegabytes` (default 20480), `cacheMaxAgeDays` (default 30).
- **`CacheAsset`** — 1:1 with `Video` (`videoId` unique). `status` (`not_cached`/`downloading`/`complete`/`failed`), `pinned`, `activeReaders` (incremented/decremented around active HTTP reads in `playbackResponse`), `lastAccessedAt`/`cachedAt`.
- **`TunarrPathMapping`** — unique on `ytarrPrefix`, ordered by `position`; used by `translatePathWithMappings` for longest-prefix path translation.
- **`LogEntry`** — sanitized operational log, `level`/`category`/`message`/`details`, optional `sourceId`/`videoId` (`onDelete: SetNull`).

Three committed migrations trace the schema's evolution: `20260903130000_init`, `20260903183000_tunarr_integration`, `20260903210000_phase2` (adds `feedType`/`historyLimit`/cache/playback-mode/path-mapping fields) — names line up with the README's MVP → Tunarr integration → Phase 2 narrative, though this checkout is not a git repository, so no commit history is available to confirm timing or authorship beyond the migration filenames themselves.

## Authentication

None is implemented. There is no user/session/credential model in `prisma/schema.prisma`, no `middleware.ts`, and no auth check in any `app/api/**/route.ts` handler. The Tunarr HTTP client sends no auth header. This is consistent with the product's "local-first, single operator" framing (see [docs/PRODUCT.md](PRODUCT.md)) but is not itself documented as a deliberate security boundary anywhere in the repo — treat it as an absence, not a designed guarantee, if this app is ever exposed beyond a trusted local network.

## Environment configuration

Read directly from `process.env`, with `.env` loaded manually (not via a framework auto-loader) by `scripts/prepare-dev.mjs` using `process.loadEnvFile`:

| Variable | Used in | Default when unset |
|---|---|---|
| `DATABASE_URL` | `lib/db/client.ts`, `scripts/prepare-dev.mjs` | `file:./ytarr.db` |
| `YTARR_YTDLP_PATH` | `lib/system/binaries.ts` | none (falls through to `which`/fallback paths) |
| `YTARR_FFMPEG_PATH` | `lib/system/binaries.ts` | none (same fallback chain) |
| `YTARR_MEDIA_DIR` | `lib/settings/service.ts` (only on first-ever `AppSettings` creation) | `storage/media` under `process.cwd()` (`lib/constants.ts:DEFAULT_MEDIA_ROOT`) |
| `YTARR_TUNARR_URL` | `lib/settings/service.ts` (first-ever creation only) | `http://127.0.0.1:8000` |
| `YTARR_THUMBNAIL_DIR` | `lib/thumbnails/service.ts` | `storage/thumbnails` under `process.cwd()` |

Beyond first boot, the effective media directory, Tunarr URL, and cache limits live in the `AppSettings` DB row and are edited via the Settings page/`PATCH /api/settings` — the env vars are bootstrap defaults only, not read on every request.

## Build and deployment model

- **`package.json` scripts**: `predev`/`prestart` run `scripts/prepare-dev.mjs` (ensures the SQLite file exists, `prisma generate`, `prisma migrate deploy`) before `next dev` / `next start`; `prebuild` runs `prisma generate` before `next build --webpack` (the build explicitly opts out of Turbopack — reason not documented in-repo).
- **`next.config.ts`**: `output: "standalone"` (self-contained server output for Docker); `outputFileTracingExcludes` keeps `storage/`, the SQLite files, and `.next/` out of the traced output; `serverExternalPackages: ["@prisma/client"]`; `images.remotePatterns` allow-lists the YouTube/Google thumbnail hosts.
- **`Dockerfile`**: three-stage build (`deps` → `builder` → `runner`). The runner stage installs `ffmpeg` and `yt-dlp` (via `apt`/`pip3 --break-system-packages`) directly into the image, creates a non-root `ytarr` user/group (uid/gid `1001`), copies the Next.js standalone output plus `prisma/` and `node_modules`, exposes port `3000`, defines a `HEALTHCHECK` against `/api/health`, and its `CMD` runs `prisma migrate deploy` then `node server.js`.
- **`compose.yaml`**: a `ytarr` service (built from the local `Dockerfile`, persists `/config` and shares `/media`) and an optional `tunarr` service gated behind the `tunarr` Compose profile (`chrisbenincasa/tunarr:latest`, mounts `/media` read-only). Named volumes `ytarr-config`, `ytarr-media`, `tunarr-config`. `YTARR_TUNARR_URL` defaults to `http://tunarr:8000` (the Compose service name) when the `tunarr` profile is used, or must be set to an external Tunarr URL otherwise.
- No CI configuration (no `.github/workflows`, no other CI config file) was found in this repository — build/test/deploy automation beyond the above is not discoverable from the checkout.

## Testing structure

`vitest.config.ts`: Node environment, `tests/**/*.test.ts`, `@` path alias mapped to the repo root (matching `tsconfig.json`'s `paths`).

| File | Covers |
|---|---|
| `tests/paths.test.ts` | `assertWithinDirectory` path-traversal guard |
| `tests/validation.test.ts` | zod schemas in `lib/validation.ts` |
| `tests/youtube.test.ts` | `lib/youtube/normalize.ts`, `lib/youtube/url.ts` |
| `tests/process.test.ts` | `lib/system/process.ts:runProcess` |
| `tests/playback.test.ts` | `parseRange` and `lib/playback/service.ts` behavior |
| `tests/tunarr.test.ts` | `TunarrApiClient`, `mapPrograms`/`orderMemberships`, `normalizeTunarrUrl` |
| `tests/tunarr.integration.test.ts` | Higher-level `lib/tunarr/service.ts` flows |
| `tests/download.integration.test.ts` | `lib/downloads/service.ts` |

Tests stub `fetch` and `child_process` at the module boundary (e.g. `vi.stubGlobal("fetch", ...)`) rather than hitting real network/processes or a real `yt-dlp`/Tunarr instance. There are no component/UI/browser tests (no `@testing-library/react`, no Playwright/Cypress config) — `components/` and `app/**/page.tsx` are untested by the automated suite.

## Important cross-cutting systems

- **Background job queue** (`lib/jobs/runner.ts` + the `Job` Prisma model). A single in-process, poll-based worker: `claimJob()` uses a conditional `updateMany` as an atomic claim (only one call can flip a given row from `queued` to `running`), `work()` loops claiming and handling jobs until none remain, then `kickWorker()`'s `.finally()` schedules a `setTimeout` wake for the next due job (capped 25ms–60s) so the process isn't busy-polling. Retries use capped exponential backoff and per-type `maxAttempts` (3 normally, 100 for `tunarr_refresh`, which is expected to keep retrying until source media jobs settle — see the `active` job count check in `handleJob`). `recoverJobs()` runs once per process lifetime to requeue anything left `running`/`downloading` after an unclean shutdown.
- **Scheduler** (`lib/jobs/scheduler.ts`). A `setInterval(60_000)` loop that enqueues due `sync` jobs, plus an hourly `enforceCachePolicy()` and a startup `reconcileCacheFiles()`. Guarded by a `globalThis` flag so concurrent invocations (e.g. across a dev-mode HMR reload) don't run twice.
- **Path safety** (`lib/settings/service.ts:assertWithinDirectory`). Resolves both the configured base directory and the target's parent through `realpath` and rejects any target that resolves outside the base — used before every filesystem write in `lib/downloads/service.ts` (permanent downloads, cache downloads, Tunarr materialization) to prevent a crafted YouTube ID or directory name from writing outside the configured media root.
- **Log/error sanitization** (`lib/logging/service.ts:sanitizeLogValue`). Applied to every `writeLog` call and to `runProcess`'s failure messages (`lib/system/process.ts`); redacts signed `googlevideo`/`youtube` URLs and `--cookies[-from-browser] <value>` flags so short-lived authenticated stream URLs and credentials never land in the persisted `LogEntry` table or bubble into an `AppError` message.
- **Atomic file writes**. Both downloaded media (`lib/downloads/service.ts:downloadMp4`, via a per-job temp subdirectory under `._ytarr-tmp/` that's `rm -rf`'d in a `finally`) and JSON sidecars/thumbnails (`writeSidecar`, `lib/thumbnails/service.ts:persist`) write to a `.tmp`/`.pid.tmp` path and `rename()` into place, so a crash mid-write can never leave a partially-written file recorded as complete.
