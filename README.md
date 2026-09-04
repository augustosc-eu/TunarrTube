# YTarr

YTarr is a local-first companion for [Tunarr](https://tunarr.com). It turns individual YouTube videos, playlists, and channels into a local media library.

YTarr analyzes playlists with `yt-dlp`, stores metadata in SQLite, detects new videos during manual syncs, and downloads explicitly selected videos as stable MP4 files. Its Tunarr integration can register each source as Local Media and create or update a channel from downloaded videos.

The UI supports light and dark mode. It follows your system preference on first visit; use the toggle at the bottom of the sidebar to switch manually — your choice is remembered on that device.

## Requirements

- Node.js 22 or newer
- `yt-dlp`
- FFmpeg
- A reachable [Tunarr](https://tunarr.com/getting-started/installation/) installation when using the Tunarr publishing features

Docker users do not need to install Node.js, `yt-dlp`, or FFmpeg on the host. The image includes them.

### macOS

```bash
brew install yt-dlp ffmpeg
```

### Linux

Install FFmpeg with the distribution package manager. Install a current `yt-dlp` release with your package manager or the [official installation instructions](https://github.com/yt-dlp/yt-dlp/wiki/Installation). Distribution copies of `yt-dlp` can lag behind YouTube changes.

### Windows

Install Node.js 22, [yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/Installation), and an [FFmpeg Windows build](https://ffmpeg.org/download.html). Put `yt-dlp.exe` and the FFmpeg `bin` directory on `PATH`, open a new PowerShell window, and verify:

```powershell
node --version
yt-dlp --version
ffmpeg -version
```

If the binaries are not on `PATH`, set `YTARR_YTDLP_PATH` and `YTARR_FFMPEG_PATH` to their absolute paths in `.env`.

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

Production startup listens on `127.0.0.1` by default. For intentional LAN access, run `npm run start:lan` behind an authenticating reverse proxy or VPN; read [SECURITY.md](SECURITY.md) first.

For schema development:

```bash
npm run db:migrate
```

## Configuration

YTarr starts with these defaults:

- Database: `prisma/ytarr.db`
- Media: `storage/media/`
- One directory per source, with YouTube video IDs as filenames

The media root can be changed in Settings. Existing source destinations move to the corresponding directory under the new root for future downloads; completed files retain their recorded paths.

Binary discovery checks `YTARR_YTDLP_PATH` / `YTARR_FFMPEG_PATH`, then `which`, then common Homebrew and Linux paths. Copy `.env.example` to `.env` only when overrides are needed.

Configure the Tunarr base URL in Settings (default `http://127.0.0.1:8000`) and use **Test Tunarr**. YTarr reads the configured server's `/openapi.json` and refuses mutations when required API capabilities are absent.

Environment values are first-start defaults. After the settings row exists, use the Settings page to change the media directory or Tunarr URL.

YTarr never sends title/description to Tunarr's API directly — Tunarr matches scanned files back to YTarr videos by filename. Instead, every downloaded video gets a companion `<youtubeId>.nfo` file next to its `.mp4`, which is what Tunarr's local media scanner actually reads for the title/description shown in its guide. Videos downloaded before this existed, or that still show their YouTube ID as the title in Tunarr, can be fixed with **Repair video metadata** in Settings — it regenerates the sidecar files in place (no re-download, the media file itself isn't touched) and refreshes any linked Tunarr channels.

## Workflow

1. Open **Sources → Add Source** and paste an HTTPS YouTube video, playlist, or channel URL.
2. Analyze the URL, review the detected count, and create the source. An individual video starts a curated collection; use **Add individual videos** on its source page to append more URLs in channel order.
3. Videos appear immediately while detailed metadata is enriched in the background.
4. Select videos and choose **Download selected**. If the source's playback mode is **Permanent download** (the default), every video already gets queued for download automatically as soon as it's added or found by a sync — selection only matters for **Cache on first play** and **Stream on demand** sources, where nothing downloads until you pick it (or play it). Change a source's mode any time in its **Playback** panel.
5. Completed files appear as `<youtubeId>.mp4` plus `<youtubeId>.json` in the source media directory.
6. Use **Sync Now** for playlist/channel sources. Curated collections change only when you add individual videos.
7. In the source's **Tunarr integration** panel, choose a channel name, optional number, and programming order. YTarr creates or reuses a Local Media source for that directory, scans it, and creates the channel. Publishing again updates the linked channel and replaces its programming.

Downloads use temporary directories and are published only after `yt-dlp` and FFmpeg finish successfully. Interrupted jobs are recovered on the next application start and retry up to three times. **Queue** in the sidebar shows every running, queued, and recently finished background job (downloads, metadata, sync, Tunarr publish, …), auto-refreshing so you can watch progress without reloading the page.

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

## Connect YTarr to Tunarr

Tunarr can run natively or in Docker independently of YTarr. Two things must be true:

1. YTarr can reach Tunarr's HTTP address.
2. Both programs can access the same media files. If they see that directory under different absolute paths, add a YTarr → Tunarr path mapping in **Settings**.

| YTarr | Tunarr | Tunarr URL from YTarr | Media setup / path mapping |
|---|---|---|---|
| Native | Native | `http://127.0.0.1:8000` | Use the same absolute media directory; no mapping. |
| Native | Docker | `http://127.0.0.1:8000` | Bind-mount the host media directory into Tunarr. Map the native YTarr path to the Tunarr container path, e.g. `/srv/ytarr` → `/media` or `D:\YTarr` → `/media`. |
| Docker | Native | `http://host.docker.internal:8000` | Bind-mount a host directory at `/media` in YTarr. Map `/media` to the path Tunarr sees, e.g. `/srv/ytarr` on Linux/macOS or `D:\YTarr` on Windows. The supplied Compose file adds the Linux `host-gateway` alias. |
| Docker | Docker, this Compose file | `http://tunarr:8000` | The shared `ytarr-media` volume is `/media` in both containers; no mapping. |
| Docker | Docker, separate stacks | A shared Docker-network service name, or `http://host.docker.internal:<published-port>` | Give both containers the same bind mount or volume. Add a mapping if their in-container mount paths differ. |

Windows drive paths are supported as Tunarr-side mapping targets even when YTarr itself runs in Linux/Docker.

### Tunarr troubleshooting

- YTarr and Tunarr must see the same absolute media path. Docker path mapping is not inferred; configure a path visible to Tunarr.
- `127.0.0.1` inside a container means that container, not the host. Use `host.docker.internal` to reach a native Tunarr installation from Docker.
- At least one source video must be completely downloaded before channel creation.
- A channel number can be left blank to use the next available Tunarr number.
- Tunarr scans run in a persistent YTarr job. Progress and sanitized failures appear in the source screen and Logs.

## Phase 2 playback and synchronization

Sources can permanently download media, cache it on first play, or stream it without retention. Cache limits default to 20 GB and 30 idle days and can be changed in Settings. Pinned, active, and Tunarr-linked assets are protected from eviction.

Automatic synchronization is configured per source and runs inside the single YTarr process. Do not run multiple replicas against the same SQLite database. Linked Tunarr channels refresh after sync and completed downloads.

Channel URLs support Videos, Shorts, archived Live streams, or all feeds, with a configurable initial history limit. Bounded channel syncs preserve older known entries that fall outside the inspection window.

## Docker

Run YTarr together with the optional Tunarr service:

```bash
docker compose --profile tunarr up -d --build
```

Run only YTarr against a native/external Tunarr:

Create a `.env` file containing:

```text
YTARR_TUNARR_URL=http://host.docker.internal:8000
```

Then run:

```bash
docker compose up -d --build
```

The Compose file persists the database/thumbnails in `ytarr-config` and media in `ytarr-media`. To make the media files visible to software on the host, replace the `ytarr-media:/media` mount with a bind mount such as `/srv/ytarr-media:/media` (Linux/macOS) or `D:/YTarr:/media` (Windows Docker Desktop), and make the equivalent mount available to Tunarr.

When Tunarr sees a different path, add an ordered mapping in Settings, for example `/media` → `/data/youtube`. Longest-prefix matching is used. Both containers need permission to read the media volume; YTarr additionally needs write permission. The container runs as UID/GID 1001.

Compose publishes both web interfaces on host loopback only. To opt into LAN access, change the relevant port binding from `127.0.0.1:...` to `0.0.0.0:...` and protect it as described in [SECURITY.md](SECURITY.md). Do not run multiple YTarr replicas against the same SQLite database.

For reproducible deployments, set `TUNARR_IMAGE` to a versioned Tunarr tag or digest instead of relying on `latest`.

## Security and project governance

YTarr has no login system and is intended for one trusted operator. Do not expose it directly to the internet or an untrusted network. See [SECURITY.md](SECURITY.md) for the deployment boundary and private vulnerability-reporting guidance.

The project is licensed under the [MIT License](LICENSE). Contributions are welcome under [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests run tests, type checking, and the production build in CI; Dependabot checks npm and GitHub Actions dependencies weekly.

## Disclaimer

YTarr is not affiliated with or endorsed by YouTube or Tunarr. You are responsible for ensuring that your use and downloading of media complies with applicable law, the source platform's terms, and the rights of content owners. The MIT license covers YTarr's source code, not media downloaded with it.
