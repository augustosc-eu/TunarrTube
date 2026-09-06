# TunarrTube — Architecture

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
proxy.ts                 Rejects browser cross-site mutations to API routes
next.config.ts, Dockerfile, compose.yaml
```

Every domain in `lib/` follows the same shape: a `service.ts` (sometimes plus `client.ts`/`types.ts`) exporting plain async functions that take/return domain data and throw `AppError` on failure. Route handlers under `app/api/**/route.ts` are thin adapters: parse (zod), call the service, return `ok(...)`/`toErrorResponse(...)`.

## Frameworks and major dependencies

From [package.json](../package.json):

- **Next.js 16.3.4** — App Router, Server Components for all pages, `output: "standalone"` build.
- **React 19.2.4** / **react-dom 19.2.4**.
- **Prisma 6.12.0** (`@prisma/client`) with the **SQLite** provider — the only datastore.
- **Zod 4.3.6** — all API input validation (`lib/validation.ts`).
- **Tailwind CSS 4.1.18** via `@tailwindcss/postcss` — `app/globals.css` imports only `tailwindcss/preflight.css` (the base reset), not the full `tailwindcss` entrypoint, so no Tailwind utility classes are generated or available; all styling is hand-written class names (`card`, `toolbar`, `badge`, etc.) styled in `globals.css` against a light/dark CSS custom-property token set (see "Theming" below).
- **lucide-react 0.468.0** — icon set used throughout `components/`. The one exception is `components/brand-mark.tsx`, a hand-written inline `<svg>` (not a lucide icon).
- **`next/font/google` (Inter)** — loaded once in `app/layout.tsx` with `variable: "--font-sans"` and applied via `className` on `<html>`; `app/globals.css` consumes it as `var(--font-sans)` with a system-font fallback chain.
- **Vitest 4.1.11** — the only test runner; no `@testing-library/*` or component-testing dependency is present.
- No client-side state management library (no Redux/Zustand/React Query/SWR). Client components use `useState` plus direct `fetch` calls against `app/api/**`, and `next/navigation`'s `useRouter().refresh()` to re-pull server-rendered data after a mutation.

## Entry points

- **`instrumentation.ts`** — Next.js's `register()` server-boot hook. Guarded by `process.env.NEXT_RUNTIME === "nodejs"` and skipped during `NEXT_PHASE === "phase-production-build"`. On a real server start it dynamically imports and calls `kickWorker()` (`lib/jobs/runner.ts`) and `startScheduler()` (`lib/jobs/scheduler.ts`). `startScheduler()` is only ever called here (it no-ops on a second call via a `globalThis` guard). `kickWorker()` is additionally called after every job-enqueueing service call (`lib/sources/service.ts`, `lib/jobs/service.ts`, `lib/playback/service.ts`, `lib/tunarr/service.ts`, `app/api/sources/[id]/route.ts`) to wake the worker promptly instead of waiting for its self-scheduled timer; it is idempotent (a no-op if the worker loop is already running).
- **`scripts/prepare-dev.mjs`** — run by the `predev` and `prestart` npm scripts. Loads `.env` if present, ensures the SQLite file's parent directory and file exist, then runs `prisma generate` and `prisma migrate deploy` via `node_modules/.bin/prisma`, exiting non-zero on failure.
- **`app/layout.tsx`** — root layout; renders `Sidebar` plus `{children}` inside a `.shell` div. Sets the `<title>` template (`"%s · TunarrTube"`), applies the `next/font/google` Inter variable to `<html>`, and renders a `beforeInteractive` inline `Script` (see "Theming" below) that sets `<html data-theme>` before hydration.
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
| `/jobs` | `app/jobs/page.tsx` | Background job queue: running/queued/recent jobs, polling |
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
| `PATCH /api/jobs/[id]` | `cancelJob` / `retryJob` / `stopJob` / `postponeJob` | `lib/jobs/service.ts` (`action: "cancel"` on a `queued` job; `action: "retry"` on a `cancelled`/`failed` one; `action: "stop"` on a `running` job of a `STOPPABLE_JOB_TYPES` type; `action: "postpone"` + `postponeMinutes` on a `queued` job) |
| `GET /api/jobs` | `listJobs` | `lib/jobs/service.ts` (running + queued + last 30 terminal jobs, polled by `/jobs`; also reports `AppSettings.jobsPaused`) |
| `PATCH /api/jobs` | `setJobsPaused` | `lib/jobs/service.ts` (`{ paused: boolean }`, the queue-wide pause/resume toggle) |
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

All under `components/`. Most are `"use client"`; three (`page-header.tsx`, `source-card.tsx`, `brand-mark.tsx`) have no client directive and render as Server Components — they're static/presentational and take no interactive state:

- **`sidebar.tsx`** *(client)* — top-level navigation (Dashboard/Sources/Videos/Queue/Cache/Logs/Settings). Client-only because it uses `next/navigation`'s `usePathname()` to highlight the active route (`aria-current="page"`); also renders `BrandMark` and mounts `ThemeToggle` in a footer row.
- **`job-queue.tsx`** *(client)* — the `/jobs` queue view: running/queued/recent job tables, self-polling `GET /api/jobs` every 3s (plus a 1s tick for live elapsed/waiting timers) independent of `router.refresh()`. Each row gets a Stop button (`running`, only if `Job.stoppable`), a Cancel button + postpone dropdown (`queued`), or a Retry button (`failed`/`cancelled`), all calling `PATCH /api/jobs/[id]`. A toolbar toggle pauses/resumes the whole queue via `PATCH /api/jobs`.
- **`brand-mark.tsx`** *(server)* — the app's logo: a small inline `<svg>` glyph filled with `var(--accent)`, sized via a `size` prop.
- **`theme-toggle.tsx`** *(client)* — sidebar-footer button that flips `<html data-theme>` between `"light"`/`"dark"`, persists the choice to `localStorage` (key from `theme-constants.ts`), and reflects the current theme in its icon/label. No dependency beyond local `useState`/`useEffect` — see "Theming" below.
- **`page-header.tsx`** *(server)* — trivial `{eyebrow, title, action}` header, reused by every page.
- **`source-card.tsx`** *(server)* — source summary tile (thumbnail, type, video count, playback mode, last synced) linking to the source detail page.
- **`add-source-form.tsx`** *(client)* — two-step flow: analyze a URL into a `Draft`, then configure name/playback mode/video quality/sync and create the source.
- **`source-actions.tsx`** *(client)* — Sync Now / Delete buttons on the source detail page; polls the resulting sync job.
- **`source-settings.tsx`** *(client)* — edits a source's `playbackMode`, `videoQuality` override, and sync enable/interval via `PATCH /api/sources/[id]`.
- **`tunarr-channel-form.tsx`** *(client)* — the Tunarr publish/reconcile/unlink UI; polls the `tunarr_publish` job and surfaces reconciliation candidates when a stored channel link is stale.
- **`video-selection-table.tsx`** *(client)* — per-video table with select/download-selected, per-row play (inline `<video>` player), and status badges (metadata/download/availability).
- **`cache-dashboard.tsx`** *(client)* — cache usage stats, per-asset pin/unpin/evict/play, and "enforce limits"/"clear evictable" actions.
- **`settings-form.tsx`** *(client)* — media directory, `yt-dlp`/FFmpeg detection, Tunarr URL + connectivity test, cache limits, default video quality, and the path-mapping editor with live preview. Exports `VIDEO_QUALITY_OPTIONS`, reused by `add-source-form.tsx`/`source-settings.tsx` for the per-source override dropdown.

## Important services (`lib/`)

- **`sources/service.ts`** — the core domain: `analyzeAndStoreDraft`, `createSourceFromDraft`, `listSources`, `getSource`, `syncSource`, `deleteSource`, `enqueueUniqueJob` (dedupes queued/running jobs by type+source+video), `enqueueSync`. `slugify` derives each source's on-disk `directoryName`. `deleteSource` removes the `Source` row (cascading its `SourceVideo`/queued `Job` rows) and cleans up only the source's own thumbnail plus orphaned videos' thumbnail/cache-asset files — it never deletes files under `source.mediaDirectory` (returns `preservedMediaDirectory`) and never calls the Tunarr API, so a linked Tunarr channel/Local Media source is left exactly as it was, just orphaned from TunarrTube's DB.
- **`downloads/service.ts`** — `downloadVideo` (permanent download via `yt-dlp`+FFmpeg into the source's directory, with hardlink/copy reuse of an identical file already downloaded for another source via `reuseExistingAsset`), `cacheVideo` (same download machinery, targeting the shared cache directory), `materializeForTunarr` (promotes a cache/stream video to a real file in the source directory so Tunarr can scan it), `retagVideo` (regenerates the `.json`/`.nfo` sidecars for an already-downloaded video from the current `Video` row, for videos downloaded before NFO sidecars existed — pure local file writes, no ffmpeg, the media file itself is never touched), `touchCacheAsset`.
- **`jobs/runner.ts`** — the single background worker: `recoverJobs()` requeues anything left `running`/`downloading` from a previous crash; `claimJob()` atomically claims the oldest due `queued` job (`updateMany` with a `status: "queued"` guard, `attempts: increment`), in three priority tiers — `retag` first (a purely local sidecar write, no network or ffmpeg), then any other non-`download` job (metadata/thumbnail/sync/cache/tunarr_*), then `download` last — so a large download backlog (slow `yt-dlp` calls, up to a 12h timeout each) can't starve quick jobs behind it; `handleJob()` dispatches by `job.type` to the relevant service function (`metadata`, `thumbnail`, `sync`, `download`, `cache`, `retag`, `tunarr_publish`, `tunarr_refresh`), passing every type but `retag`/`thumbnail` a fresh per-job `AbortController`'s signal; `work()` loops until no jobs remain (checking `AppSettings.jobsPaused` before each claim so a pause takes effect between jobs, never mid-job), retries failures with capped exponential backoff (`min(60, 2^attempts * 2)` seconds) up to `job.maxAttempts` (3, except `tunarr_refresh` = 100), and re-enqueues a `tunarr_refresh` job after any `download`/`cache`/`retag` job completes for a source with a linked Tunarr channel. Before claiming, the controller for each running job is registered in an in-process `Map` (`ytarrControllers` on `globalThis`, keyed by job id) so `requestJobStop()` — called by `stopJob()` in `jobs/service.ts` — can look it up and call `.abort()`; the `work()` loop's `catch` checks `controller.signal.aborted` to tell a user-requested stop apart from a real failure and calls `markJobCancelled()` instead of the ordinary retry/fail path. `STOPPABLE_JOB_TYPES` (`download`, `cache`, `sync`, `metadata`, `tunarr_publish`, `tunarr_refresh`) lists the types whose service function actually threads that signal into a `runProcess`/`fetch` call; `retag` (local, near-instant) and `thumbnail` (a couple of quick image fetches) aren't included; `stopJob()` rejects a stop request for a type that isn't. A `download`/`cache` failure whose message matches `isRateLimitedError` (`lib/youtube/ytdlp.ts`, an HTTP 429/"Too Many Requests" signal from `yt-dlp`) is treated as YouTube throttling rather than an ordinary failure: it skips the per-job backoff entirely, undoes its own `attempts` increment (so a 429 never counts toward `maxAttempts`), and pushes `runAfter` for *every* other queued `download`/`cache` job out to the same cooldown — an in-process `globalThis` counter (`ytarrRateLimitHits`) escalates that cooldown (120s, doubling, capped at 30 min) across consecutive 429s and resets to zero the next time a `download`/`cache` job succeeds. `kickWorker()` starts/wakes the loop (no-op if `jobsPaused`) and self-schedules a wake timer for the next due job.
- **`jobs/scheduler.ts`** — `runDueSyncs()` finds sources with `syncEnabled` and a due `nextSyncAt`, updates `nextSyncAt`, and enqueues a `sync` job for each; `startScheduler()` runs it once immediately, then every 60s via `setInterval`, plus an hourly `enforceCachePolicy()` and a one-time `reconcileCacheFiles()` at boot.
- **`jobs/service.ts`** — `enqueueDownloads` (bulk, validates membership, skips already-complete), `getJob`, `listJobs` (running + queued + last 30 terminal jobs, each with its `source`/`video` names, plus the queue's `paused` flag — powers the `/jobs` queue page), `cancelJob`/`retryJob`/`stopJob`/`postponeJob` (per-job cancel/retry/stop/postpone from the `/jobs` queue page; see "Cancelling and stopping a job" below), `setJobsPaused` (the queue-wide pause toggle, persisted on `AppSettings.jobsPaused`).
- **`tunarr/client.ts`** — `TunarrApiClient`: thin typed wrapper over the Tunarr HTTP API (`/openapi.json`, `/api/version`, `/api/system/health`, `/api/media-sources`, `/api/media-sources/{id}/libraries/{id}/scan`, `/api/media-sources/{id}/{libraryId}/status`, `/api/media-libraries/{id}/programs`, `/api/channels`, `/api/channels/{id}`, `/api/channels/{id}/programming`, `/api/transcode_configs`). `discover()` checks that every required (path, method) pair is present in the target server's OpenAPI document before anything is allowed to mutate.
- **`tunarr/service.ts`** — `publishSourceToTunarr` (the full publish flow: prefetch if needed → ensure local media source/library → scan → wait for the queued scan to actually start/finish, using complete filename matches as the fast path when everything is already indexed → list programs → match by filename via `mapPrograms` → order via `orderMemberships` → create/update channel → replace programming), `tunarrLinkStatus`, `reconcileTunarrLink`, `unlinkTunarr` (deletes only locally-materialized `retentionOrigin: "tunarr"` files, never the remote Tunarr channel), `testTunarrConnection`, `enqueueTunarrPublish`. `channelPayload`'s channel `number` defaults to the *existing* channel's current number (`existing?.number`), not "next available", when updating a channel that's already linked — only a genuinely new channel or an explicit `input.channelNumber` picks a fresh number. Getting this wrong silently renumbers the channel on every automatic `tunarr_refresh`.
  - **How Tunarr actually gets a real title**: TunarrTube never sends title/description over the Tunarr API — `replaceProgramming` only posts `{type, id, duration}`. Tunarr's `other_videos` local-media scanner ignores the video file's own container metadata entirely and instead reads a Kodi-style `<youtubeId>.nfo` sidecar (`<movie><title>…</title><plot>…</plot></movie>`, same basename as the `.mp4`) — see `lib/downloads/service.ts:buildNfo`/`writeNfo`, written alongside the `.json` sidecar by `downloadVideo`, `materializeForTunarr`, and `retagVideo`. Without that `.nfo` file, Tunarr falls back to the bare filename (the YouTube ID) as the title, with no error. Confirmed against a live Tunarr instance: neither embedding ffmpeg container tags nor calling `POST /api/programs/{id}/scan` changes the displayed title — only the `.nfo` file does, and only after a fresh `scanLibrary` (Docs: https://tunarr.com/configure/media_sources/local/other_videos/).
  - **How Tunarr gets program artwork**: the same scanner also picks up local Kodi-style artwork — a `<youtubeId>-poster.<ext>` file, same basename convention as the NFO — to power its guide and "now playing" thumbnail for that program. `lib/downloads/service.ts:writePosterArtwork` copies the video's already-locally-mirrored thumbnail (`Video.thumbnailPath`, populated by `lib/thumbnails/service.ts`) into the source's media directory under that name, alongside the `.nfo`/`.json` sidecars, in `downloadVideo`, `materializeForTunarr`, and `retagVideo`. It's best-effort — a video whose thumbnail mirror job hasn't finished (or failed) yet is downloaded without one, and Tunarr just shows a broken image for that program until a `retag` re-runs after the thumbnail exists. `unlinkTunarr` removes it alongside the `.json`/`.nfo` sidecars for videos it deletes.
- **`cache/service.ts`** — `enforceCachePolicy` (evicts complete, unpinned, non-active, non-Tunarr-protected assets, oldest-accessed first, until under the configured byte limit and idle-age cutoff — a 5-minute grace period protects freshly-cached assets from immediate eviction), `cacheDashboard`, `mutateCacheAsset`, `reconcileCacheFiles` (marks DB rows `not_cached` if their file is missing on disk), `protectedVideoIds` (videos required by a linked Tunarr channel).
- **`playback/service.ts`** — `preparePlayback` (returns `ready` immediately if a local file exists or the source streams; otherwise enqueues a `download`/`cache` job and returns `queued`), `playbackResponse` (HTTP range-request file streaming for local files via `createReadStream`; live proxy to a resolved YouTube CDN URL for `stream`-mode sources with no local file, forwarding the `Range` header), `parseRange` (RFC 7233 `bytes=` parsing).
- **`settings/service.ts`** — `getSettings`/`getSettingsView` (the singleton `AppSettings` row, `id: 1`, self-healing if its directory was moved externally), `updateSettings` (validates and moves future source destinations to a new media root; existing completed files are **not** moved), `normalizeTunarrUrl`, `translatePathWithMappings`/`translatePathForTunarr` (longest-prefix path translation for the Tunarr integration), `assertWithinDirectory` (path-traversal guard used before every filesystem write derived from user/DB data), `validateMediaDirectory`.
- **`metadata/service.ts`** — `enrichVideo`: background job that re-fetches full `yt-dlp` metadata for a video and marks it `metadataStatus: "complete"`/`"failed"`, or `availability: "unavailable"` if the error text matches private/unavailable/deleted/removed.
- **`thumbnails/service.ts`** — `persistSourceThumbnails` (mirrors a source's and its videos' remote thumbnails to local disk under `storage/thumbnails/{sources,videos}/`, allow-listing only YouTube/Google image hosts), `thumbnailResponse` (serves the local file with ETag/cache headers), `removeSourceThumbnail`.
- **`youtube/ytdlp.ts`** — all `yt-dlp` invocations: `analyzePlaylist`, `analyzeChannelFeed`/`analyzeSource` (merges videos/shorts/live when `feedType: "all"`), `fetchVideoMetadata`, `resolveStreamUrl` (takes the effective `VideoQuality`, validates the resolved URL is actually a `youtube.com`/`googlevideo.com` HTTPS host before returning it).
- **`youtube/quality.ts`** — the six-preset `VideoQuality` enum (`best`/`2160p`/`1440p`/`1080p`/`720p`/`480p`), `resolveEffectiveQuality` (per-source override falls back to the global default), and `downloadFormatSelector`/`streamFormatSelector` (build the `-f` selector for the download and stream call sites respectively).
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

1. **`yt-dlp`** — invoked exclusively via `lib/system/process.ts:runProcess`, wrapped by `lib/youtube/ytdlp.ts`. Used for: playlist/channel analysis (`--dump-single-json --flat-playlist`), single-video metadata refresh, permanent video download (`-f <selector> --concurrent-fragments 4 --merge-output-format mp4 --remux-video mp4 --embed-metadata`, via `--ffmpeg-location`), and resolving a direct stream URL for `stream`-mode playback (`--get-url -f <selector>`). `--remux-video mp4` (not `--recode-video`) is deliberate: the format selector already prefers `vcodec^=avc`/`acodec^=mp4a` streams that merge into an mp4 container as a stream copy, so remuxing only touches the container (fast, lossless) instead of unconditionally re-encoding every download; it only actually transcodes on the rare fallback path that lands on an mp4-incompatible codec. `--concurrent-fragments 4` downloads DASH fragments in parallel for faster throughput per download. The `-f` format selector is built per-request by `lib/youtube/quality.ts` (`downloadFormatSelector`/`streamFormatSelector`) from the effective video-quality preset — a per-`Source.videoQuality` override if set, else `AppSettings.defaultVideoQuality`. The `best` preset (the default) reproduces the original fixed selector (`bv*[vcodec^=avc]+ba[acodec^=mp4a]/b[ext=mp4]/best` for download, `b[ext=mp4][vcodec^=avc][acodec^=mp4a]/b[ext=mp4]/best` for streaming) byte-for-byte; the five capped presets (`2160p`/`1440p`/`1080p`/`720p`/`480p`) add a `[height<=N]` constraint to the same codec-preferring fallback chain, ending in a bare `best` so an unavailable resolution degrades gracefully instead of failing. `--embed-metadata` embeds title/description as container tags (harmless for other players, but **not** what makes Tunarr show a real title — see below). Binary location is resolved by `lib/system/binaries.ts:discoverBinary` (env override → `which` → fallback paths).
2. **FFmpeg** — not invoked directly by TunarrTube; only located (`discoverBinary("ffmpeg")`) and its directory passed to `yt-dlp --ffmpeg-location` so `yt-dlp` can remux/recode.
3. **Tunarr HTTP API** — `lib/tunarr/client.ts`. Capability-discovered via `/openapi.json` before any mutating call. Consumes `/api/media-sources`, channel scan/status, `/api/media-libraries/{id}/programs`, `/api/channels`, `/api/transcode_configs`. No API key/auth header is sent — the integration assumes an unauthenticated (or network-trusted) local Tunarr instance.
4. **Remote thumbnail hosts** — `i.ytimg.com`, `img.youtube.com`, `yt3.ggpht.com`, `*.googleusercontent.com` (allow-listed in `next.config.ts` for `next/image`, and independently in `lib/thumbnails/service.ts`'s `ALLOWED_HOSTS` for the server-side mirroring fetch).
5. **Live YouTube CDN** — for `stream`-mode playback, `playbackResponse` proxies a `googlevideo.com`/`youtube.com` URL resolved just-in-time by `resolveStreamUrl`, forwarding `Range` and streaming the upstream body straight through.

## Persistence

SQLite via Prisma ([prisma/schema.prisma](../prisma/schema.prisma)). Dev default file: `prisma/ytarr.db` (`DATABASE_URL="file:./ytarr.db"`); Docker default: `/config/ytarr.db`. Models:

- **`Source`** — one configured playlist/channel. Unique on `(sourceType, youtubeId, feedType)` and on `directoryName`. Carries playback mode, an optional `videoQuality` override (`null` = fall back to `AppSettings.defaultVideoQuality`; see [External integrations](#external-integrations)), sync config (`syncEnabled`, `syncIntervalMinutes`, `nextSyncAt`, `lastSyncedAt`, `lastSyncStatus`), and the full set of `tunarr*` linkage fields (`tunarrMediaSourceId`, `tunarrLibraryId`, `tunarrChannelId`, `tunarrChannelNumber`, `tunarrLastPublishedAt`, `tunarrChannelName`, `tunarrRequestedChannelNumber`, `tunarrProgrammingOrder`).
- **`Video`** — canonical, deduplicated by `youtubeId` (unique). Carries `metadataStatus` (`pending`/`complete`/`failed`) and `availability` (`unknown`/`available`/`unavailable`).
- **`SourceVideo`** — join table, unique on `(sourceId, videoId)`. Per-source-per-video state: `playlistIndex`, `membershipStatus` (`present`/`missing`), `downloadStatus` (`not_downloaded`/`queued`/`downloading`/`complete`/`failed`), `localPath`, `fileSize` (`BigInt`), `retentionOrigin` (`none`/`permanent`/`tunarr`).
- **`ImportDraft`** — ephemeral analysis result; `expiresAt` (1h from creation) and `consumedAt` gate reuse; indexed on `expiresAt` for cleanup.
- **`Job`** — the generic work queue: `type`, `status` (`queued`/`running`/`complete`/`failed`/`cancelled`), `sourceId`/`videoId` (optional FKs, `onDelete: Cascade`), `payloadJson`, `attempts`/`maxAttempts`, `error`, `runAfter` (backoff/scheduling), timestamps. Indexed for the worker's claim query and for `enqueueUniqueJob`'s dedupe lookup.
- **`AppSettings`** — singleton, `id` pinned to `1`: `mediaBaseDirectory`, `tunarrUrl`, `cacheMaxMegabytes` (default 20480), `cacheMaxAgeDays` (default 30), `defaultVideoQuality` (default `"best"`), `jobsPaused` (default `false` — the queue-wide pause toggle, checked by `jobs/runner.ts`'s `work()`/`kickWorker()`).
- **`CacheAsset`** — 1:1 with `Video` (`videoId` unique). `status` (`not_cached`/`downloading`/`complete`/`failed`), `pinned`, `activeReaders` (incremented/decremented around active HTTP reads in `playbackResponse`), `lastAccessedAt`/`cachedAt`.
- **`TunarrPathMapping`** — unique on `ytarrPrefix`, ordered by `position`; used by `translatePathWithMappings` for longest-prefix path translation.
- **`LogEntry`** — sanitized operational log, `level`/`category`/`message`/`details`, optional `sourceId`/`videoId` (`onDelete: SetNull`).

Five committed migrations trace the schema's evolution: the initial schema, Tunarr integration, Phase 2 playback/cache support, video availability reasons, and per-source video quality.

## Authentication

None is implemented. There is no user/session/credential model in `prisma/schema.prisma` and no authorization check in any `app/api/**/route.ts` handler. The Tunarr HTTP client sends no auth header. This is an explicit local, single-operator security boundary documented in `README.md` and `SECURITY.md`: TunarrTube must not be exposed directly to the public internet or an untrusted LAN. Native production startup and Compose publish to host loopback by default.

`proxy.ts` adds defense in depth for browser-based CSRF by rejecting state-changing API requests whose Fetch Metadata identifies them as `cross-site`. Requests without browser Fetch Metadata (such as trusted scripts) are permitted; this is not authentication and does not make a network-exposed TunarrTube safe. `next.config.ts` adds restrictive framing, MIME-sniffing, referrer, feature, and partial CSP headers.

## Environment configuration

Read directly from `process.env`, with `.env` loaded manually (not via a framework auto-loader) by `scripts/prepare-dev.mjs` using `process.loadEnvFile`:

| Variable | Used in | Default when unset |
|---|---|---|
| `DATABASE_URL` | `lib/db/client.ts`, `scripts/prepare-dev.mjs` | `file:./ytarr.db` |
| `TUNARRTUBE_YTDLP_PATH` | `lib/system/binaries.ts` | none (falls through to `which`/fallback paths) |
| `TUNARRTUBE_FFMPEG_PATH` | `lib/system/binaries.ts` | none (same fallback chain) |
| `TUNARRTUBE_MEDIA_DIR` | `lib/settings/service.ts` (only on first-ever `AppSettings` creation) | `storage/media` under `process.cwd()` (`lib/constants.ts:DEFAULT_MEDIA_ROOT`) |
| `TUNARRTUBE_TUNARR_URL` | `lib/settings/service.ts` (first-ever creation only) | `http://127.0.0.1:8000` |
| `TUNARRTUBE_THUMBNAIL_DIR` | `lib/thumbnails/service.ts` | `storage/thumbnails` under `process.cwd()` |

The corresponding `YTARR_*` names remain supported as lower-precedence legacy aliases. The `ytarr.db` filename, `ytarrPrefix` persistence/API field, `._ytarr-*` work directories, `ytarr-theme` browser key, and Compose volume keys are likewise retained to preserve installed data and preferences.

Beyond first boot, the effective media directory, Tunarr URL, and cache limits live in the `AppSettings` DB row and are edited via the Settings page/`PATCH /api/settings` — the env vars are bootstrap defaults only, not read on every request.

## Build and deployment model

- **`package.json` scripts**: `predev`/`prestart` run `scripts/prepare-dev.mjs` (ensures the SQLite file exists, `prisma generate`, `prisma migrate deploy`) before `next dev` / `next start`; production `npm start` binds to `127.0.0.1`, while the explicit `start:lan` script binds all interfaces; `prebuild` runs `prisma generate` before `next build --webpack` (the build explicitly opts out of Turbopack — reason not documented in-repo).
- **`next.config.ts`**: `output: "standalone"` (self-contained server output for Docker); `outputFileTracingExcludes` keeps `storage/`, the SQLite files, and `.next/` out of the traced output; `serverExternalPackages: ["@prisma/client"]`; `images.remotePatterns` allow-lists the YouTube/Google thumbnail hosts; global response headers provide browser hardening.
- **`Dockerfile`**: three-stage build (`deps` → `builder` → `runner`). The dependency stage installs OpenSSL and copies `prisma/schema.prisma` before `npm ci` because Prisma Client generation runs in `postinstall`. The runner stage installs `ffmpeg` and `yt-dlp` (via `apt`/`pip3 --break-system-packages`) directly into the image, creates a non-root `tunarrtube` user/group (uid/gid `1001`), copies the Next.js standalone output plus `prisma/` and `node_modules`, exposes port `3000`, defines a `HEALTHCHECK` against `/api/health`, and its `CMD` runs `prisma migrate deploy` then `node server.js`.
- **`compose.yaml`**: a least-privilege `tunarrtube` service (built from the local `Dockerfile`, all Linux capabilities dropped, privilege escalation disabled, persists `/config` and shares `/media`) and an optional `tunarr` service gated behind the `tunarr` Compose profile (`TUNARR_IMAGE`, defaulting to `chrisbenincasa/tunarr:latest`, mounts `/media` read-only). Named volumes `ytarr-config`, `ytarr-media`, and `tunarr-config` retain their legacy keys for data compatibility. Both published ports bind to host loopback. The TunarrTube service defines `host.docker.internal:host-gateway` so it can address a native Tunarr host on Linux as well as Docker Desktop. `TUNARRTUBE_TUNARR_URL` defaults to `http://tunarr:8000` when the profile is used, or must point to an external Tunarr otherwise.
- **CI/dependency maintenance**: `.github/workflows/ci.yml` runs tests, type checking, and a production build on pushes and pull requests. `.github/dependabot.yml` checks npm and GitHub Actions dependencies weekly.

## Testing structure

`vitest.config.ts`: Node environment, `tests/**/*.test.ts`, `@` path alias mapped to the repo root (matching `tsconfig.json`'s `paths`).

| File | Covers |
|---|---|
| `tests/paths.test.ts` | `assertWithinDirectory` path-traversal guard and cross-platform Tunarr path translation |
| `tests/validation.test.ts` | zod schemas in `lib/validation.ts` |
| `tests/youtube.test.ts` | `lib/youtube/normalize.ts`, `lib/youtube/url.ts` |
| `tests/process.test.ts` | `lib/system/process.ts:runProcess` |
| `tests/playback.test.ts` | `parseRange` and `lib/playback/service.ts` behavior |
| `tests/tunarr.test.ts` | `TunarrApiClient`, `mapPrograms`/`orderMemberships`, `normalizeTunarrUrl` |
| `tests/tunarr.integration.test.ts` | Higher-level `lib/tunarr/service.ts` flows |
| `tests/download.integration.test.ts` | `lib/downloads/service.ts` |

Tests stub `fetch` and `child_process` at the module boundary (e.g. `vi.stubGlobal("fetch", ...)`) rather than hitting real network/processes or a real `yt-dlp`/Tunarr instance. There are no component/UI/browser tests (no `@testing-library/react`, no Playwright/Cypress config) — `components/` and `app/**/page.tsx` are untested by the automated suite.

## Important cross-cutting systems

- **Background job queue** (`lib/jobs/runner.ts` + the `Job` Prisma model). A single in-process, poll-based worker: `claimJob()` uses a conditional `updateMany` as an atomic claim (only one call can flip a given row from `queued` to `running`), checking for a due non-`download` job before falling back to the oldest due `download` job, `work()` loops claiming and handling jobs until none remain (or `AppSettings.jobsPaused` is set — checked before each claim), then `kickWorker()`'s `.finally()` schedules a `setTimeout` wake for the next due job (capped 25ms–60s, skipped while paused) so the process isn't busy-polling. Retries use capped exponential backoff and per-type `maxAttempts` (3 normally, 100 for `tunarr_refresh`, which is expected to keep retrying until source media jobs settle — see the `active` job count check in `handleJob`) — except a `download`/`cache` failure recognized as YouTube rate-limiting (see `jobs/runner.ts` above), which pauses the whole download/cache queue on an escalating cooldown instead of consuming an attempt. `recoverJobs()` runs once per process lifetime to requeue anything left `running`/`downloading` after an unclean shutdown.
- **Scheduler** (`lib/jobs/scheduler.ts`). A `setInterval(60_000)` loop that enqueues due `sync` jobs, plus an hourly `enforceCachePolicy()` and a startup `reconcileCacheFiles()`. Guarded by a `globalThis` flag so concurrent invocations (e.g. across a dev-mode HMR reload) don't run twice.
- **Cancelling and stopping a job** (`lib/jobs/service.ts:cancelJob`/`retryJob`/`stopJob`/`postponeJob`, `PATCH /api/jobs/[id]`, the Stop/Cancel/postpone/Retry controls in `components/job-queue.tsx`). `cancelJob` only reaches a `queued` job (including one sitting in a retry backoff). A `running` job instead goes through `stopJob`, which looks up the `AbortController` the runner registered for it (`requestJobStop()`/the `ytarrControllers` map, `lib/jobs/runner.ts`) and calls `.abort()` — that signal is threaded into `runProcess`/`fetch` for `STOPPABLE_JOB_TYPES` (`download`, `cache`, `sync`, `metadata`, `tunarr_publish`, `tunarr_refresh`; see `downloadMp4`/`downloadVideo`/`cacheVideo` in `lib/downloads/service.ts`, `syncSource` in `lib/sources/service.ts`, `enrichVideo` in `lib/metadata/service.ts`, `publishSourceToTunarr` in `lib/tunarr/service.ts`), which reject with a cancellation once the underlying process/fetch is killed; `retag`/`thumbnail` jobs have no interrupt point and `stopJob` rejects a request for them outright. Either path is sticky the same way: it marks the underlying `SourceVideo.downloadStatus`/`CacheAsset.status` `"cancelled"` (`markJobCancelled()`, shared by both), and the automatic re-enqueue paths that would otherwise pick it back up — `syncSource`'s download loop (`lib/sources/service.ts`) and `materializeForTunarr`'s Tunarr-publish prefetch (`lib/downloads/service.ts`) — both explicitly skip a `"cancelled"` video, so it stays out of the queue/lineup until `retryJob` (or, for a `cache`/`stream` source, simply playing the video again) explicitly brings it back. `retryJob` doesn't resurrect the old `Job` row; it resets the `SourceVideo`/`CacheAsset` status and calls `enqueueUniqueJob` for a fresh one with a clean `attempts` counter. Switching a source's playback mode to "download" (`PATCH /api/sources/[id]`) is the one deliberate exception: that bulk action re-downloads everything not `"complete"`, cancelled videos included. `postponeJob` is unrelated to cancellation: it just pushes a `queued` job's `runAfter` out (any number of minutes) without touching `status`/`attempts`, so `claimJob()` leaves it alone until that time passes. `setJobsPaused` is the queue-wide version — it flips `AppSettings.jobsPaused`, which stops new claims but never interrupts a job already running (pair it with `stopJob` to actually halt everything).
- **Path safety** (`lib/settings/service.ts:assertWithinDirectory`). Resolves both the configured base directory and the target's parent through `realpath` and rejects any target that resolves outside the base — used before every filesystem write in `lib/downloads/service.ts` (permanent downloads, cache downloads, Tunarr materialization) to prevent a crafted YouTube ID or directory name from writing outside the configured media root.
- **Log/error sanitization** (`lib/logging/service.ts:sanitizeLogValue`). Applied to every `writeLog` call and to `runProcess`'s failure messages (`lib/system/process.ts`); redacts signed `googlevideo`/`youtube` URLs and `--cookies[-from-browser] <value>` flags so short-lived authenticated stream URLs and credentials never land in the persisted `LogEntry` table or bubble into an `AppError` message.
- **Atomic file writes**. Both downloaded media (`lib/downloads/service.ts:downloadMp4`, via a per-job temp subdirectory under `._ytarr-tmp/` that's `rm -rf`'d in a `finally`) and JSON sidecars/thumbnails (`writeSidecar`, `lib/thumbnails/service.ts:persist`) write to a `.tmp`/`.pid.tmp` path and `rename()` into place, so a crash mid-write can never leave a partially-written file recorded as complete.
- **Theming (light/dark mode)**. Entirely CSS custom properties, no runtime theming library. `app/globals.css` defines the full color/spacing/radius/shadow token set twice: once on bare `:root` (the light palette, also the SSR/no-JS default) and once under `@media (prefers-color-scheme: dark)` (dark palette, system preference); an explicit user choice is layered on top via `:root[data-theme="light"]`/`:root[data-theme="dark"]`, which — by selector specificity, not `!important` — always wins over the media query. The choice is applied before hydration by a `beforeInteractive` `next/script` block in `app/layout.tsx` that reads `localStorage` (key `"ytarr-theme"`, exported from `components/theme-constants.ts`) and sets `document.documentElement.dataset.theme`; `<html suppressHydrationWarning>` covers the resulting one-attribute mismatch between server and client markup. `components/theme-toggle.tsx` is the only thing that ever writes that `localStorage` key or flips the attribute after load. Status colors (`--success`/`--warning`/`--error`) are intentionally independent CSS variables from the brand accent (`--accent`, teal) — no badge or status state derives its color from the accent.
