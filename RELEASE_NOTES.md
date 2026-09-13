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
