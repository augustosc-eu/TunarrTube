# TunarrTube Extended v0.4.0

## More video sites

TunarrTube now accepts URLs from **Bilibili, bilibili.tv, Internet Archive, Vimeo, Dailymotion, Twitch, and Niconico** as well as YouTube. Videos, playlists, and channel-like pages (Bilibili profiles, Vimeo/Dailymotion users, Twitch channels, Niconico users) work the same way YouTube's do: analyze, sync, download, and publish to Tunarr. README's "A URL cannot be analyzed" lists the exact link shapes each site accepts.

- **Multi-part videos.** A Bilibili video with several parts, or an Internet Archive item with several video files, adds every part. A link to one part (`?p=N`) or one file adds just that one.
- **bilibili.tv**, Bilibili's international site, is supported separately from bilibili.com: uploaded videos, show episodes, and whole shows (added like a playlist). It has no channel sources, because yt-dlp can't list an uploader's videos there.
- **Bilibili profiles** include collections the uploader hides from their uploads list, up to 25 per profile. If TunarrTube can't read every collection, analyzing or syncing that profile fails with an error. It never syncs without them.
- **Stream on demand** works for YouTube and Internet Archive only. Sources from other sites can't select it, and such a video added to a stream-mode collection is cached on first play instead.
- **Sign-in.** Vimeo now only serves videos to signed-in clients, so it needs a yt-dlp cookies file from a Vimeo account (Settings → External tools). Without one, every Vimeo video is marked as requiring sign-in. Many Niconico videos need one too. One cookies file can hold cookies for several sites.
- Only these sites are accepted, on purpose. TunarrTube still won't hand arbitrary URLs to yt-dlp, which would let anyone with access make the server request internal network addresses.

## Fixes

- A custom filename template no longer treats an ID-like bracket inside a title (for example `Mirror [archive.2024]`) as the video's ID. Such files now get the real ID appended, so Tunarr matches them correctly. This applies to new downloads; existing files keep their names.
- One failing source no longer stops the rest of a scheduled sync run, and the startup sync and hourly cache cleanup no longer crash with unhandled errors.
- A failed download can no longer leave a video stuck as "downloading", and a problem after a download finishes can no longer mark the completed video as failed.
- Titles and other yt-dlp output in Chinese, Japanese, and other multi-byte scripts are no longer garbled when they arrive in pieces.

## Upgrading

No database changes this time. Back up your database and media directory first, as with any upgrade.

- Native installs now need **Node.js 22.13 or newer**.
- The Docker image now runs Node.js 25.
- Dependency updates, including Next.js 16.4.3, Prisma 7.10.1, and React 19.3.1.

# TunarrTube Extended v0.3.0

## Breaking changes

- **API field rename:** path mappings in `GET/PATCH /api/settings` and `POST /api/settings/path-preview` use `tunarrtubePrefix` instead of `ytarrPrefix`. Update any scripts or integrations that send or read it.

## Upgrading

Existing data moves to the new names automatically on first start. Back up your database and media directory first, as with any upgrade.

Once upgraded, an older version can no longer read the renamed database. To go back, restore the backup you took before upgrading.

- The SQLite file `ytarr.db` is renamed to `tunarrtube.db` (Docker: `/config/tunarrtube.db`). If you set `DATABASE_URL` yourself and it names `ytarr.db`, it keeps working unchanged; to adopt the new name, point it at `tunarrtube.db` in the same folder and the file is renamed on the next start.
- The hidden `._ytarr-cache` folder in your media directory becomes `._tunarrtube-cache`, and leftover `._ytarr-tmp` folders are removed.
- Docker Compose keeps using your existing volumes: the volume keys are renamed, but `name:` points them at the volumes they were created as. Don't edit those lines.
- A saved light/dark theme choice carries over.
- `YTARR_*` environment variables (and `YTARR_PORT` in Compose) keep working but are deprecated. TunarrTube logs a warning at startup naming each one, so you can rename it to its `TUNARRTUBE_*` equivalent (for example `YTARR_YTDLP_PATH` → `TUNARRTUBE_YTDLP_PATH`).
- If Docker Compose ever refuses to start with "Docker Compose did not set COMPOSE_PROJECT_NAME", upgrade Compose or set `COMPOSE_PROJECT_NAME` to the name your stack already used (usually the folder name). This guard stops Compose from attaching new, empty volumes.

## Also in this release

- **Ready-made Docker images.** Releases are now published to `ghcr.io/augustosc-eu/tunarrtube` for `linux/amd64` and `linux/arm64`, so you can run TunarrTube without building it. See README's "Published images".
- Optional password protection (`TUNARRTUBE_AUTH_PASSWORD`) for installs reachable from other machines, and stricter blocking of browser requests from other sites, including other ports on the same host.
- The Docker image runs Node.js 24 and ships a self-updating yt-dlp, so **Update** in Settings now works in the container.
- The Docker image now builds on linux/arm64 (Apple Silicon, Raspberry Pi), where v0.2.0's build failed because `better-sqlite3` had to be compiled with no compiler available.
- AI Programming defaults to `claude-opus-5-5` (new `TUNARRTUBE_ANTHROPIC_MODEL` override) and `gpt-5`.
- Unexpected server errors no longer return internal details in API responses.
- Delayed downloads resume on time even while another long job is running.

# TunarrTube Extended v0.2.0

A major feature release on top of v0.1.0: a whole second publishing surface (curated, overlay-rendered **Channels**), AI-driven scheduling across three providers, and a set of reliability fixes for Tunarr publishing found and closed out during real-world use — including one bug in Tunarr itself, reported upstream.

> [!IMPORTANT]
> This is still pre-1.0 software intended for one trusted operator. TunarrTube has no authentication or authorization layer. Keep it on localhost or behind an authenticated reverse proxy or VPN, and back up its SQLite database and media directory before upgrading.

## Highlights

- **Channels**: hand-pick clips into a curated, ordered lineup and burn in a title/artist/album overlay (or a custom HTML/CSS template you design visually), published as its own Tunarr channel — alongside, not instead of, a Source's own 1:1 Tunarr channel.
- **AI Programming**: turn a Source or Channel into a real dayparts/weekly or endless-rotation schedule, via Anthropic, OpenAI, or a locally installed **Claude Code CLI** — no API key needed for that path, using your existing Claude Code sign-in instead.
- **Content selection at scale**: pick clips onto a Channel with an AI-interpreted free-text brief, or with **Smart** heuristic selection (no AI provider required) — freshness, spread across sources, target clip length, or grouped-by-source/artist blocks.
- **AI Programming Director**: describe a schedule in plain language and preview exactly what the AI proposes before anything is saved or sent to Tunarr.
- **Explicit publish status.** A channel now shows **Published** only once Tunarr has actually confirmed it can serve that channel's guide — not just that a remote channel object exists. A publish that didn't finish shows **Publish incomplete** instead of silently looking the same as a working one.
- **A real Tunarr bug found and reported.** A channel whose schedule ends up empty, or whose programming references content Tunarr can no longer resolve, could send Tunarr's own guide-builder into an infinite loop — pegging a CPU core and making Tunarr's entire server unresponsive for every channel, not just the broken one, even across restarts. TunarrTube now verifies each publish's guide before reporting success, containing this to one failed, retryable publish instead of a dead Tunarr instance. See **Known issues** below.

## Channels (new)

- Curate a lineup from an already-downloaded video, a pasted YouTube URL (downloaded through an automatically created companion Source), or a scanned local folder.
- Design an overlay visually — text bound to clip metadata, static PNG/GIF images (logo bugs) — or start from the built-in "Music Video Lower Third" template.
- Each clip's artist is filled in automatically where possible (YouTube's own official-music tags, or a background MusicBrainz/iTunes lookup only applied above a confidence threshold you control), editable and searchable by hand.
- Render, preview inline, and publish as an independent Tunarr channel, sharing TunarrTube's existing download/job pipeline rather than a separate one.

## AI Programming

- Dayparts (daily or weekly, fixed time slots) or endless rotation (weighted, with per-group cooldowns), for both Sources and Channels.
- Three providers: Anthropic, OpenAI, or a local **Claude Code CLI** — enable it in Settings → AI Assistant with no API key at all, using your existing Claude Code authentication. Uses your real Claude usage, not a separate fee; see the README's Claude Code Integration section before enabling it.
- Ready-made **concept presets** (Balanced variety, Throwback/retro countdown, Late night chill, High energy/party) as an editable starting point for the instructions box.
- The **AI Programming Director**: describe a schedule in plain language, preview the resolved clip titles/block timings/warnings, then apply — regenerating a schedule is a real, billed call, only triggered again when candidates or instructions actually changed since the last publish.
- **Smart** heuristic content selection: a deterministic, no-AI-provider-required alternative that scores candidates by novelty, freshness, and duration fit.

## Reliability fixes (Tunarr publishing)

Found through two real incidents publishing an AI-scheduled channel, where Tunarr's own guide-builder hung the entire Tunarr server:

- `verifyChannelGuide` — every publish now asks Tunarr to actually compute the channel's near-term guide, under TunarrTube's own bounded timeout, before reporting success. A channel that would have hung Tunarr's background guide refresh now fails cleanly as one retryable job instead.
- Custom Show creation/update timeouts raised from 15s to 60s, and progress is now persisted incrementally as each one succeeds — a publish that fails partway through several sequential writes no longer recreates everything from scratch on retry, and no longer piles up orphaned duplicate objects in Tunarr.
- A schedule that resolves to zero programs is now rejected before ever reaching Tunarr, on both the manual and AI-scheduled paths.
- `tunarrLastPublishedAt`, not the earlier-persisted `tunarrChannelId`, is now the "successfully published" signal shown in the UI — see **Explicit publish status** above.
- **A genuine bug in Tunarr itself was found, isolated, and reported upstream**: [chrisbenincasa/tunarr#2087](https://github.com/chrisbenincasa/tunarr/issues/2087), cross-referencing the maintainer-acknowledged architectural gap in [#1962](https://github.com/chrisbenincasa/tunarr/issues/1962) and the cascade-delete mechanism in [#1973](https://github.com/chrisbenincasa/tunarr/issues/1973). TunarrTube's fixes above contain the damage; they don't fix Tunarr's own code.

## Operations and interface

- Persistent job dedup is now database-enforced (a unique, nullable `activeKey`), removing an earlier find-then-create race; a dedicated download limiter serializes concurrent media fetches across independent callers.
- Job cancellation and history handling fixes; `channel_publish` jobs correctly retain their `channelId` across retries.
- Grid/list view toggle, remembered per view, for Channels and other list pages.
- yt-dlp binary update handling now tracks and reports version changes.
- Cleaner YouTube video title parsing (artist/title splitting, noise-annotation stripping) for videos without official metadata.

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

See the [README](README.md) for operating-system instructions, Docker storage, path mappings, external Tunarr configurations, and the full Channels/AI Programming walkthroughs.

## Compatibility notes

- No breaking schema changes since v0.1.0 — all new `Channel`/`Source` columns are additive and nullable; existing installations pick up new features without any manual migration step beyond the normal `prisma migrate deploy` already run on startup.
- Existing `YTARR_*` environment variables remain supported as legacy aliases; new installations should use `TUNARRTUBE_*` names.
- The existing `ytarr-config`/`ytarr-media` Docker volume names and the `ytarr.db` SQLite filename are unchanged, for the same reason as v0.1.0: upgrading in place should never disconnect an installation from its stored data.
- Only one TunarrTube process may use a given SQLite database — still true, and now also true of test runs: `npm test` uses its own dedicated `ytarr.test.db`, never the dev database, as of this release.

## Known issues

- **Tunarr's own guide-builder can hang its entire server** in a way TunarrTube can only detect and contain, not fix — see the Reliability fixes section above and [chrisbenincasa/tunarr#2087](https://github.com/chrisbenincasa/tunarr/issues/2087). If Tunarr is already unresponsive, restarting it alone won't help (guide-building runs at startup); see the README's Troubleshooting section for recovery.
- All v0.1.0 limitations still apply: public YouTube URLs only (no cookies/account credentials/private media beyond the opt-in, file-path-only cookies setting); no built-in authentication, authorization, or TLS termination; a Tunarr channel can never stream a video live from YouTube in any playback mode (Tunarr's local-media scanner only reads real files on disk); the SQLite-backed worker supports a single application instance, not a replicated deployment.

## Legal

TunarrTube is not affiliated with or endorsed by YouTube, Tunarr, or Anthropic. Users are responsible for ensuring that downloading or streaming media complies with applicable law, platform terms, and content-owner rights. The MIT license covers TunarrTube's source code, not downloaded media.
