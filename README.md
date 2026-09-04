# YTarr

YTarr is a local-first companion for [Tunarr](https://tunarr.com). It turns individual YouTube videos, playlists, and channels into a local media library.

YTarr analyzes playlists with `yt-dlp`, stores metadata in SQLite, detects new videos during manual syncs, and downloads explicitly selected videos as stable MP4 files. Its Tunarr integration can register each source as Local Media and create or update a channel from downloaded videos.

The UI supports light and dark mode. It follows your system preference on first visit; use the toggle at the bottom of the sidebar to switch manually — your choice is remembered on that device.

## Requirements

- Node.js 22 or newer
- `yt-dlp`
- FFmpeg

macOS with Homebrew:

```bash
brew install yt-dlp ffmpeg
```

Linux package names vary by distribution. Ensure `yt-dlp` and `ffmpeg` are executable on `PATH`.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Development and production startup generate Prisma Client and apply the committed SQLite migrations automatically.

For production:

```bash
npm run build
npm start
```

For schema development:

```bash
DATABASE_URL="file:./ytarr.db" npx prisma migrate dev
```

## Configuration

YTarr starts with these defaults:

- Database: `prisma/ytarr.db`
- Media: `storage/media/`
- One directory per source, with YouTube video IDs as filenames

The media root can be changed in Settings. Existing source destinations move to the corresponding directory under the new root for future downloads; completed files retain their recorded paths.

Binary discovery checks `YTARR_YTDLP_PATH` / `YTARR_FFMPEG_PATH`, then `which`, then common Homebrew and Linux paths. Copy `.env.example` to `.env` only when overrides are needed.

Configure the Tunarr base URL in Settings (default `http://127.0.0.1:8000`) and use **Test Tunarr**. YTarr reads the configured server's `/openapi.json` and refuses mutations when required API capabilities are absent.

YTarr never sends title/description to Tunarr's API directly — Tunarr matches scanned files back to YTarr videos by filename. Instead, every downloaded video gets a companion `<youtubeId>.nfo` file next to its `.mp4`, which is what Tunarr's local media scanner actually reads for the title/description shown in its guide. Videos downloaded before this existed, or that still show their YouTube ID as the title in Tunarr, can be fixed with **Repair video metadata** in Settings — it regenerates the sidecar files in place (no re-download, the media file itself isn't touched) and refreshes any linked Tunarr channels.

## Workflow

1. Open **Sources → Add Source** and paste an HTTPS YouTube video, playlist, or channel URL.
2. Analyze the URL, review the detected count, and create the source. An individual video starts a curated collection; use **Add individual videos** on its source page to append more URLs in channel order.
3. Videos appear immediately while detailed metadata is enriched in the background.
4. Select videos and choose **Download selected**.
5. Completed files appear as `<youtubeId>.mp4` plus `<youtubeId>.json` in the source media directory.
6. Use **Sync Now** for playlist/channel sources. Curated collections change only when you add individual videos.
7. In the source's **Tunarr integration** panel, choose a channel name, optional number, and programming order. YTarr creates or reuses a Local Media source for that directory, scans it, and creates the channel. Publishing again updates the linked channel and replaces its programming.

Downloads use temporary directories and are published only after `yt-dlp` and FFmpeg finish successfully. Interrupted jobs are recovered on the next application start and retry up to three times.

## Troubleshooting

### yt-dlp or FFmpeg is not found

Open Settings to see the detected path and version. If needed, set an absolute override in `.env`:

```text
YTARR_YTDLP_PATH="/opt/homebrew/bin/yt-dlp"
YTARR_FFMPEG_PATH="/opt/homebrew/bin/ffmpeg"
```

### A YouTube URL cannot be analyzed

YTarr accepts public HTTPS video, playlist, and channel URLs on standard YouTube domains, including `youtu.be` links. Private/account-only media, cookies, and age-restricted authentication are not supported. Run `yt-dlp -U` or update it with your package manager if YouTube changes break extraction.

If YTarr reports that `yt-dlp` detected playlist items but could not extract them, the installed extractor is outdated. Update `yt-dlp`, restart YTarr, and use **Sync Now**; an existing empty source does not need to be recreated.

### A download failed

Review Logs for the sanitized `yt-dlp` or FFmpeg error. Check free disk space and that the source media directory is writable, then select the video again to retry. YTarr never deletes a prior completed file because an online video disappeared.

## Development checks

```bash
npm test
npm run typecheck
npm run build
```

## Tunarr troubleshooting

- YTarr and Tunarr must see the same absolute media path. Docker path mapping is not inferred; configure a path visible to Tunarr.
- At least one source video must be completely downloaded before channel creation.
- A channel number can be left blank to use the next available Tunarr number.
- Tunarr scans run in a persistent YTarr job. Progress and sanitized failures appear in the source screen and Logs.

## Phase 2 playback and synchronization

Sources can permanently download media, cache it on first play, or stream it without retention. Cache limits default to 20 GB and 30 idle days and can be changed in Settings. Pinned, active, and Tunarr-linked assets are protected from eviction.

Automatic synchronization is configured per source and runs inside the single YTarr process. Do not run multiple replicas against the same SQLite database. Linked Tunarr channels refresh after sync and completed downloads.

Channel URLs support Videos, Shorts, archived Live streams, or all feeds, with a configurable initial history limit. Bounded channel syncs preserve older known entries that fall outside the inspection window.

## Docker

Run YTarr with its bundled optional Tunarr service:

```bash
docker compose --profile tunarr up -d --build
```

Run only YTarr by omitting `--profile tunarr` and setting `YTARR_TUNARR_URL` to an externally managed server. The Compose file persists the database/thumbnails in `ytarr-config` and shares `ytarr-media` at `/media` with Tunarr.

When Tunarr sees a different path, add an ordered mapping in Settings, for example `/media` → `/data/youtube`. Longest-prefix matching is used. Both containers need permission to read the media volume; YTarr additionally needs write permission. The container runs as UID/GID 1001.
