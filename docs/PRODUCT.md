# TunarrTube — Product

## What it is

TunarrTube is a local-first companion application for [Tunarr](https://tunarr.com) (a self-hosted "live TV from your media library" server). It turns public YouTube playlists and channels into a synchronized local media library, then can publish that library as a live-TV-style channel inside Tunarr.

Concretely, TunarrTube:

1. Analyzes a YouTube playlist or channel with `yt-dlp` and stores the resulting metadata in a local SQLite database.
2. Detects new/removed items on manual or scheduled sync, without discarding history.
3. Downloads explicitly selected videos as stable, re-encoded MP4 files (or caches/streams them, depending on the source's playback mode).
4. Registers the source's media directory with Tunarr as a Local Media source and creates/updates a Tunarr channel whose programming is built from the downloaded videos.

Source: [README.md](../README.md), corroborated end-to-end by [lib/sources/service.ts](../lib/sources/service.ts), [lib/downloads/service.ts](../lib/downloads/service.ts), and [lib/tunarr/service.ts](../lib/tunarr/service.ts).

## Who it serves

A single local operator who self-hosts Tunarr and wants specific YouTube playlists/channels to behave like TV channels, without manually downloading and organizing video files. There is no multi-user, multi-tenant, or authentication concept anywhere in the schema or API (see [docs/ARCHITECTURE.md](ARCHITECTURE.md#authentication) and [docs/DECISIONS.md](DECISIONS.md)) — the product is built for one trusted operator on a loopback-only host or behind an operator-managed authenticated boundary, consistent with the README's "local-first companion" framing.

## Core user journeys

These are traced directly from the route handlers, service functions, and page/component code (not assumed):

### 1. Add a source
`Sources → Add Source` ([app/sources/new/page.tsx](../app/sources/new/page.tsx), [components/add-source-form.tsx](../components/add-source-form.tsx)):
- Paste an HTTPS YouTube playlist or channel URL.
- **Analyze** (`POST /api/sources/analyze`) runs `yt-dlp --dump-single-json --flat-playlist` and stores the result as a time-limited `ImportDraft` (1 hour TTL, `lib/sources/service.ts:analyzeAndStoreDraft`). The UI shows the detected name, uploader, thumbnail, and video count.
- For channel URLs, the user also picks a feed type (Videos / Shorts / archived Live / All) and a history limit (how many recent items to consider).
- Choose a playback mode (Permanent download / Cache on first play / Stream on demand) and optionally enable automatic sync with an interval.
- **Create** (`POST /api/sources`) consumes the draft, creates the `Source` and its `Video`/`SourceVideo` rows, and enqueues background `metadata`, `thumbnail`, and (if download mode) `download` jobs for every video — see "Choose a retention strategy per source" below for what each playback mode auto-queues.

### 2. Review and download videos
On a source's detail page ([app/sources/[id]/page.tsx](../app/sources/%5Bid%5D/page.tsx), [components/video-selection-table.tsx](../components/video-selection-table.tsx)):
- Videos appear immediately after creation; per-video metadata (description, duration, upload date) fills in as background `metadata` jobs complete.
- The user selects videos and clicks **Download selected**, which posts to `POST /api/downloads` and polls job status until each finishes. For a **download**-mode source this is largely redundant with step 1's auto-queue (see below) and mainly useful for a video whose download failed or was skipped; for **cache**/**stream**-mode sources it is the only thing that triggers a permanent download ahead of playback.
- Completed downloads are written as `<mediaDirectory>/<youtubeId>.mp4` plus a `<youtubeId>.json` sidecar with title/description/duration/source metadata.
- A **Play** button on each row prepares playback (`POST /api/playback/prepare`) and opens an inline `<video>` player streamed from `GET /api/playback/[sourceId]/[videoId]`.

### 3. Sync a source
- **Sync Now** ([components/source-actions.tsx](../components/source-actions.tsx)) calls `POST /api/sources/[id]/sync`, which re-analyzes the source URL, adds newly found videos, and marks memberships no longer present as `missing` — it does **not** delete video metadata or already-downloaded media.
- Automatic sync runs the same logic on a per-source interval, driven by `lib/jobs/scheduler.ts` inside the single TunarrTube process.
- Bounded channel syncs (a channel source with a `historyLimit`) skip the "mark missing" sweep so older, previously-seen entries that fall outside the current inspection window are preserved rather than flagged missing (`lib/sources/service.ts:syncSource`).

### 4. Publish to Tunarr
From a source's **Tunarr integration** panel ([components/tunarr-channel-form.tsx](../components/tunarr-channel-form.tsx)):
- Choose a channel name, optional channel number (defaults to the next available Tunarr number), and a programming order (playlist order / oldest first / newest first / random).
- **Create/Update Tunarr Channel** (`POST /api/sources/[id]/tunarr`) enqueues a `tunarr_publish` job. That job:
  - Ensures a Tunarr "Local Media" source exists pointing at this source's media directory (translated through configured path mappings if TunarrTube and Tunarr see different absolute paths).
  - Triggers and waits for a Tunarr library scan.
  - Matches scanned Tunarr programs to downloaded videos by filename (the YouTube ID), in the requested programming order.
  - Creates or updates the Tunarr channel and replaces its entire programming lineup.
- At least one video in the source must be fully downloaded before a channel can be created.
- **Reconcile** re-links a source to its Tunarr channel/media source if IDs drift (e.g. the channel was recreated on the Tunarr side). **Unlink** forgets the local link without touching the remote Tunarr objects.
- Publishing again later (e.g. after a sync or new downloads) updates the same channel in place and replaces its programming — it does not create a duplicate channel.

### 5. Choose a retention strategy per source (Phase 2)
Each source has a `playbackMode`:
- **download** — every video is permanently downloaded into the source's media directory (the original MVP behavior).
- **cache** — nothing downloads up front; a video is fetched into a shared cache directory the first time it's played, subject to a size/age eviction policy (default 20 GB / 30 idle days, configurable in Settings). Pinned, actively-playing, or Tunarr-linked assets are protected from eviction.
- **stream** — nothing is ever stored; playback proxies a signed YouTube URL resolved on demand, with no retention at all.

Publishing a **cache** or **stream** source to Tunarr materializes (downloads) every video into the source's media directory first, since Tunarr needs local files to scan — see `lib/tunarr/service.ts:publishSourceToTunarr` and `lib/downloads/service.ts:materializeForTunarr`.

### 6. Operate and monitor
- **Dashboard** (`/`) — source count, unique video count, downloaded asset count, and the most recently updated sources.
- **Videos** (`/videos`) — the canonical, deduplicated video library across all sources, with availability and duration.
- **Queue** (`/jobs`) — every running, queued, and recently finished background job (download, cache, metadata, thumbnail, sync, retag, Tunarr publish/refresh) with its target and status, self-polling every few seconds.
- **Cache** (`/cache`) — usage dashboard (used/pinned/protected/evictable bytes), per-asset pin/unpin/evict actions, and manual "enforce limits" / "clear evictable" actions.
- **Logs** (`/logs`) — sanitized operational history (source, sync, metadata, download, video categories), filterable by category. Signed YouTube URLs and cookie flags are redacted before any log line is persisted.
- **Settings** (`/settings`) — base media directory, `yt-dlp`/FFmpeg detection ("Test" buttons), Tunarr base URL and connectivity test, cache size/age limits, and ordered Tunarr path mappings with a live preview.

## Product terminology

| Term | Meaning |
|---|---|
| **Source** | A YouTube playlist or channel subscription the user configured. Owns a media directory, a playback mode, sync settings, and (optionally) a linked Tunarr channel. |
| **Video** | A canonical YouTube video record, deduplicated by YouTube ID across all sources that reference it. |
| **SourceVideo** | The join between a `Source` and a `Video`: playlist position, membership status (`present`/`missing`), and this source's download status/local path/retention origin for that video. |
| **ImportDraft** | An ephemeral (1-hour TTL) record of an `yt-dlp` analysis, created by "Analyze" and consumed by "Create Source". Prevents re-running `yt-dlp` between analyze and create. |
| **Job** | A queued unit of background work: `metadata`, `thumbnail`, `sync`, `download`, `cache`, `tunarr_publish`, `tunarr_refresh`. Processed one at a time by the single in-process worker. |
| **Playback mode** | Per-source retention strategy: `download` (permanent), `cache` (download on first play, evictable), `stream` (no retention, live proxy). |
| **Retention origin** | Why a downloaded file exists on disk for a given `SourceVideo`: `permanent` (user-requested download), `tunarr` (materialized only to satisfy a Tunarr publish), or `none`. |
| **Feed type** | For channel sources, which YouTube feed to read: `videos`, `shorts`, `live` (archived live streams), or `all` (merged, deduplicated, newest-first). |
| **History limit** | For channel sources, how many recent items `yt-dlp` should inspect per sync. `null` means unbounded. |
| **Programming order** | How a Tunarr channel's videos are ordered when a lineup is published: `playlist`, `oldest`, `newest`, or `random`. |
| **CacheAsset** | The cache-mode counterpart to a downloaded file: a single shared cached copy of a `Video`, independent of any one source, with pin/eviction state. |
| **Path mapping** | An ordered, longest-prefix translation from a TunarrTube filesystem path to the path Tunarr sees for the same directory (needed when the two run in different containers/mounts). |

## Intended behavior and constraints

These are explicit, stated constraints — either in the README or directly enforced in code — not assumptions:

- **Public HTTPS YouTube URLs only**, on `youtube.com`/`www.youtube.com`/`m.youtube.com`/`music.youtube.com` (`lib/youtube/url.ts`). Private/unlisted-via-cookie, age-restricted, or authenticated extraction is explicitly out of scope for this MVP (README, "Troubleshooting").
- **Single TunarrTube process.** The README explicitly warns not to run multiple replicas against the same SQLite database; the job worker and scheduler rely on in-process state with no distributed locking.
- **Never destroys a completed download because the source disappeared online.** A sync marks a `SourceVideo` `missing`; it does not delete the file or its metadata (README, and enforced in `lib/sources/service.ts:syncSource`).
- **At least one fully downloaded video is required before a Tunarr channel can be created** (`lib/tunarr/service.ts:publishSourceToTunarr`).
- **TunarrTube and Tunarr must agree on the same absolute media path.** Docker path translation is never inferred automatically — the operator must configure an ordered path mapping in Settings when the two see different mount points.
- **Tunarr integration is capability-gated.** Before any mutation, TunarrTube reads the configured Tunarr server's `/openapi.json` and refuses to proceed if a required endpoint is missing, rather than guessing at compatibility (README; `lib/tunarr/client.ts:discover`).
- **Downloads are atomic from the caller's perspective.** A video is only recorded as downloaded after `yt-dlp` and FFmpeg both finish successfully into a temporary location that is then renamed into place; interrupted jobs are recovered (requeued) on the next application start and retried up to three times.
