# YTarr — Decisions

This document records architectural and product decisions that can be reliably traced to this repository — either stated explicitly in documentation/comments, or strongly evidenced by the implementation. It does not speculate about historical reasoning that isn't recoverable from the checkout. This repository is **not a git repository** (no `.git` directory), so no commit history, PR discussion, or commit-message rationale is available; every decision below is sourced from the current README and source code only.

Each entry is labeled:
- **Explicit** — stated directly in the README or a code comment.
- **Evidenced** — not stated in prose, but unambiguous from how the code is written and organized.
- **Unclear** — a real design choice exists, but its motivation cannot be determined from what's in the repo.

---

### Single YTarr process; no distributed job coordination
**Explicit.** The README states: "Automatic synchronization is configured per source and runs inside the single YTarr process. Do not run multiple replicas against the same SQLite database." This matches the implementation directly: `lib/jobs/runner.ts` and `lib/jobs/scheduler.ts` hold worker/scheduler state on `globalThis` with no lock table, advisory lock, or leader-election mechanism — only safe under a single running instance.

### SQLite as the only datastore
**Explicit.** `prisma/schema.prisma`'s `datasource db { provider = "sqlite" }`, and the README: "stores metadata in SQLite." The deployment model reinforces this as deliberate rather than incidental: the Dockerfile ships a single-file DB under `/config`, and `compose.yaml` defines no separate database service.

### Downloads are atomic (temp directory + rename)
**Explicit** (behavior) **/ Evidenced** (mechanism). README: "Downloads use temporary directories and are published only after `yt-dlp` and FFmpeg finish successfully." The mechanism — a per-attempt temp subdirectory under `._ytarr-tmp/`, `rename()` into the final path, `rm -rf` of the temp directory in a `finally` — is in `lib/downloads/service.ts:downloadMp4`. The same temp-then-rename pattern is reused for JSON sidecars (`writeSidecar`) and mirrored thumbnails (`lib/thumbnails/service.ts:persist`), which is evidenced-only (not called out in prose) but is clearly the same deliberate pattern applied consistently.

### A prior completed download is never deleted because the video disappeared online
**Explicit.** README: "YTarr never deletes a prior completed file because an online video disappeared." Directly evidenced in `lib/sources/service.ts:syncSource`, which sets `membershipStatus: "missing"` on a `SourceVideo` rather than deleting it or its `localPath`.

### Hardlink-first, copy-fallback reuse of already-downloaded files
**Evidenced.** `lib/downloads/service.ts:reuseExistingAsset` and `materializeForTunarr` both attempt `link()` first and fall back to `copyFile` on failure (e.g. across filesystems/volumes). Not documented in prose, but the intent is unambiguous: avoid storing duplicate copies of the same video when it's referenced by more than one source, or when a cached copy is promoted to a permanent one, while still working when a hardlink isn't possible.

### Tunarr integration is capability-gated via OpenAPI discovery, not version-string matching
**Explicit.** README: "YTarr reads the configured server's `/openapi.json` and refuses mutations when required API capabilities are absent." Implemented in `lib/tunarr/client.ts:discover`, which checks a fixed map of required (path, method) pairs before any create/update call is permitted, and is invoked from `publishSourceToTunarr` before any mutation.

### Videos are matched to scanned Tunarr programs by filename (YouTube ID), not a stored external mapping
**Evidenced.** `lib/tunarr/service.ts:mapPrograms` extracts `path.basename(externalId, ext)` from each scanned Tunarr program and matches it against `video.youtubeId`. No comment states why, but it directly depends on the download naming convention (`<youtubeId>.mp4`) being stable, and avoids needing to persist or synchronize a separate Tunarr-program-to-video mapping table.

### Per-source retention strategy: download / cache / stream
**Explicit.** The README's "Phase 2 playback and synchronization" section documents all three modes and their tradeoffs directly ("Sources can permanently download media, cache it on first play, or stream it without retention"). The `playbackMode` field, `lib/downloads/service.ts:cacheVideo`, and `lib/playback/service.ts:preparePlayback`/`playbackResponse` implement exactly this.

### Cache eviction protects pinned, actively-playing, and Tunarr-linked assets
**Explicit** (guarantee) **/ Evidenced** (mechanism). README: "Pinned, active, and Tunarr-linked assets are protected from eviction." `lib/cache/service.ts:enforceCachePolicy` skips any asset that is `pinned`, has `activeReaders > 0`, or whose video ID is in `protectedVideoIds()` (videos required by a source with a linked Tunarr channel).

### Publishing to Tunarr with `cache`/`stream` playback modes materializes (fully downloads) every video first
**Evidenced.** `publishSourceToTunarr` calls `materializeForTunarr` for every membership when `source.playbackMode !== "download"` and `input.prefetch !== false`. Not called out in the README in these terms, but it follows necessarily from Tunarr needing real local files to scan, and the UI states it plainly: "Cache and Stream sources are fully prefetched on their first publication" (`components/tunarr-channel-form.tsx`).

### No authentication or multi-user model
**Evidenced**, not stated as a decision anywhere. There is no user/session/credential model in the Prisma schema, no `middleware.ts`, and no auth check in any API route or the Tunarr client. This is consistent with the product's "local-first companion" framing but the repository never states this absence as an intentional security boundary — treat it as unaddressed rather than deliberately scoped out.

### Log and error-message sanitization of signed URLs and cookie flags
**Evidenced.** `lib/logging/service.ts:sanitizeLogValue` specifically targets `googlevideo`/`youtube` URLs and `--cookies[-from-browser]` argument values with dedicated regexes, and is applied both to every persisted `LogEntry` and to `runProcess`'s failure messages (`lib/system/process.ts`). No comment explains the motivation, but the specificity of the redaction targets (signed CDN URLs, credential-bearing CLI flags) makes the intent — never let short-lived authenticated URLs or credentials land in persisted logs or bubble into a client-visible error message — unambiguous.

### Media directory changes only affect *future* downloads
**Explicit.** README: "The media root can be changed in Settings. Existing source destinations move to the corresponding directory under the new root for future downloads; completed files retain their recorded paths." Matches `lib/settings/service.ts:updateSettings`, which updates each `Source.mediaDirectory` but never touches existing `SourceVideo.localPath` values or moves files on disk.

### Explicit longest-prefix path mapping for Tunarr, not automatic path inference
**Explicit.** README: "Docker path mapping is not inferred; configure a path visible to Tunarr" and "Longest-prefix matching is used." Implemented in `lib/settings/service.ts:translatePathWithMappings`, sorting candidate mappings by resolved-prefix length before selecting a match.

### Migration history follows the README's stated phases
**Evidenced**, with a caveat. The three committed migrations — `20260903130000_init`, `20260903183000_tunarr_integration`, `20260903210000_phase2` — line up in name and content with the README's MVP → Tunarr integration → Phase 2 sections. This correlation is strong, but this checkout has no git history, so the actual chronology, authorship, or reasoning behind the phased rollout beyond what the README already states cannot be independently confirmed.

### `next build --webpack` (Turbopack not used for the production build)
**Unclear.** `package.json`'s `build` script explicitly passes `--webpack`. Nothing in the repository states why Turbopack (evidently otherwise available/default in this Next.js version, per the AGENTS.md-embedded warning that this Next.js differs from what a model may expect) was avoided for the build. Do not assume a reason; consult `node_modules/next/dist/docs/` for this Next.js version's current guidance before changing this.

### No client-side state management library
**Evidenced.** Every client component in `components/` uses local `useState` plus direct `fetch` calls and `router.refresh()`; no Redux/Zustand/React Query/SWR appears in `package.json` or anywhere in the codebase. Not stated as a decision, but consistently applied across all ten client components with no exception, which rules out mere oversight.

### No CI configuration is present in this checkout
**Unclear** whether this reflects a deliberate choice (e.g. CI configured outside this repository, or not yet set up) or simply hasn't been added yet. No `.github/workflows`, `.gitlab-ci.yml`, or equivalent was found. This is a gap to flag, not a decision to attribute.
