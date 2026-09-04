# TunarrTube v0.1.0

Initial public pre-release of TunarrTube, a self-hosted companion that turns public YouTube videos, playlists, and channels into a local media library and publishes them as channels in [Tunarr](https://tunarr.com).

> [!IMPORTANT]
> This is pre-1.0 software intended for one trusted operator. TunarrTube has no authentication or authorization layer. Keep it on localhost or behind an authenticated reverse proxy or VPN, and back up its SQLite database and media directory before upgrading.

## Highlights

- Import individual YouTube videos, playlists, and channels.
- Select Videos, Shorts, archived Live streams, or combined channel feeds.
- Synchronize sources manually or on a configurable schedule.
- Choose permanent download, cache-on-first-play, or stream-on-demand behavior per source.
- Publish downloaded media to Tunarr as Local Media and create or update channel lineups.
- Run natively on macOS, Linux, or Windows, or use the included Docker Compose stack.

## YouTube library management

- Analyze public HTTPS YouTube URLs with `yt-dlp` before creating a source.
- Preserve playlist ordering and support configurable history limits for large channels.
- Enrich videos with descriptions, durations, upload dates, thumbnails, and availability information in the background.
- Detect newly added and missing source memberships without deleting previously completed downloads.
- Keep one canonical video record when the same YouTube video belongs to multiple sources.

## Playback and storage

- **Permanent download** queues every discovered video and stores a stable local MP4.
- **Cache on first play** downloads into a shared, size- and age-limited cache.
- **Stream on demand** proxies a short-lived YouTube media URL without retaining the video.
- Generate JSON and NFO sidecars so Tunarr can display useful program metadata.
- Reuse existing files with hardlinks when possible, falling back to copies across filesystems.
- Write downloads and metadata atomically using temporary paths followed by rename.
- Protect pinned, actively playing, and Tunarr-linked cache assets from eviction.

## Tunarr integration

- Discover Tunarr API capabilities from its OpenAPI document before making changes.
- Create or reuse a Local Media source for each TunarrTube source directory.
- Create and update channel programming in playlist, oldest-first, newest-first, or random order.
- Translate paths when TunarrTube and Tunarr see the same media under different native or container paths.
- Reconcile links when a Tunarr channel or media source has been recreated.
- Preserve remote Tunarr objects when unlinking or deleting a local source.

## Operations and interface

- Dashboard views for sources, videos, downloads, and recent activity.
- Persistent background queue for metadata, thumbnails, downloads, synchronization, cache work, and Tunarr publishing.
- Automatic recovery of interrupted jobs after application restart.
- Cache usage controls with pin, unpin, evict, enforce-limit, and clear-evictable actions.
- Sanitized operational logs that redact signed media URLs and cookie-related command arguments.
- Light and dark themes with remembered browser preference.
- Metadata repair for downloads created before NFO sidecars were available.

## Deployment and security

- Multi-stage Docker image containing Node.js, `yt-dlp`, and FFmpeg.
- Optional Tunarr service in the included Compose profile.
- Loopback-only default port bindings for both native production and Docker deployments.
- Non-root Docker runtime with dropped Linux capabilities and `no-new-privileges`.
- Cross-site protection for state-changing API requests and baseline browser security headers.
- Automated tests, TypeScript checking, production builds, and dependency updates through GitHub Actions and Dependabot.

## Install

Run TunarrTube with the optional Tunarr container:

```bash
docker compose --profile tunarr up -d --build
```

Or run it natively with Node.js 22+, `yt-dlp`, and FFmpeg:

```bash
npm install
npm run build
npm start
```

See the [README](README.md) for operating-system instructions, Docker storage, path mappings, and external Tunarr configurations.

## Compatibility notes

- Existing `YTARR_*` environment variables remain supported as legacy aliases; new installations should use `TUNARRTUBE_*` names.
- The existing `ytarr-config` and `ytarr-media` Docker volume names are intentionally retained to avoid disconnecting upgrades from stored data.
- The SQLite filename remains `ytarr.db` for the same compatibility reason.
- Only one TunarrTube process may use a given SQLite database. The job worker and scheduler do not provide distributed locking.

## Known limitations

- Public YouTube URLs only; cookies, account credentials, private media, and authenticated age-restricted extraction are unsupported.
- TunarrTube has no built-in user accounts, authentication, authorization, or TLS termination.
- YouTube extraction can break when YouTube changes its site behavior; keeping `yt-dlp` current is essential.
- Publishing requires Tunarr to read the same completed media files, either at the same path or through an explicit path mapping.
- At least one video must be downloaded before a permanent-download source can be published to Tunarr.
- The SQLite-backed worker supports a single application instance, not a replicated deployment.

## Legal

TunarrTube is not affiliated with or endorsed by YouTube or Tunarr. Users are responsible for ensuring that downloading or streaming media complies with applicable law, platform terms, and content-owner rights. The MIT license covers TunarrTube's source code, not downloaded media.
