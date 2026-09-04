<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TunarrTube — Agent Instructions

These are the persistent engineering instructions for any AI agent (Claude, Codex, or otherwise) working in this repository. They are operational, not exhaustive — for product and architectural knowledge, read the docs listed below before making non-trivial changes.

## Read first

- [docs/PRODUCT.md](docs/PRODUCT.md) — what TunarrTube is, who it serves, core user journeys, terminology.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the architecture that actually exists: structure, data flow, integrations, persistence, build/deploy.
- [docs/DECISIONS.md](docs/DECISIONS.md) — decisions that are explicit or strongly evidenced in the code, and open questions that aren't.
- [README.md](README.md) — user-facing setup, workflow, and troubleshooting; kept in sync with actual behavior and a reliable source of truth for intended behavior.

## Repository shape

- `app/` — Next.js App Router: pages (`app/**/page.tsx`, mostly async Server Components reading Prisma directly) and API route handlers (`app/api/**/route.ts`).
- `components/` — client (`"use client"`) UI components. They call the `app/api/**` routes with `fetch` and hold local state; there is no client-side state library.
- `lib/` — the actual application: one directory per domain service (`sources`, `downloads`, `jobs`, `tunarr`, `cache`, `playback`, `settings`, `metadata`, `thumbnails`, `youtube`, `system`, `logging`, `db`), plus `api.ts` (response helpers) and `validation.ts` (zod schemas). Route handlers are thin: parse input with zod, call a `lib/` function, wrap the result with `ok()`/`toErrorResponse()`.
- `prisma/` — `schema.prisma` (SQLite) and committed migrations.
- `storage/` — local media and thumbnails (dev default; overridable by env/Settings).
- `tests/` — vitest unit/integration tests, run against real modules with `fetch`/`child_process` stubbed via `vi.stubGlobal`.

## Working principles

1. **Service layer owns behavior; routes stay thin.** Business logic, Prisma calls, and side effects belong in `lib/<domain>/service.ts`. A new API route should mostly parse (zod), call a service function, and return `ok(...)`/`toErrorResponse(...)`.
2. **Errors are `AppError`.** Throw `new AppError(code, message, httpStatus, details?)` (from `lib/api.ts`) for any expected failure; `toErrorResponse` turns it into `{ error: { code, message, details } }`. Don't invent ad-hoc error shapes.
3. **Validate at the boundary.** Every route that accepts a body validates it with a schema in `lib/validation.ts` before calling into a service. Add new input shapes there, not inline in the route.
4. **BigInt fields must go through `serialize()`.** `fileSize` columns are Prisma `BigInt`; any response including them must be wrapped in `serialize()` (from `lib/api.ts`) or `JSON.stringify` will throw.
5. **Never write outside the configured media root.** Use `assertWithinDirectory` (`lib/settings/service.ts`) for any path built from user- or DB-derived segments before touching the filesystem.
6. **Downloads/writes are temp-then-rename.** Follow the existing pattern in `lib/downloads/service.ts` (write to a temp path, `rename` into place) so a crash or failed job never leaves a half-written file recorded as complete.
7. **Sanitize before logging.** Route error messages, process output, and `writeLog` calls through `sanitizeLogValue` (`lib/logging/service.ts`) — it redacts signed YouTube/Googlevideo URLs and `--cookies` flags. Never log raw yt-dlp stderr or stream URLs.
8. **Background work goes through the job queue.** Don't spawn `yt-dlp`/FFmpeg or call the Tunarr API directly from a request handler for anything that can be slow; enqueue a `Job` via `enqueueUniqueJob` (`lib/sources/service.ts`) and let `lib/jobs/runner.ts` process it. Call `kickWorker()` after enqueueing so the job runs promptly instead of waiting for the next poll.
9. **This app assumes a single running instance.** The job worker and scheduler use in-process `globalThis` state with no distributed locking (see `lib/jobs/runner.ts`, `lib/jobs/scheduler.ts`). Do not add code that assumes multiple replicas share work safely against the same SQLite file.
10. **TunarrTube never deletes a previously completed download just because the source video disappeared upstream.** Sync marks memberships `missing`, it doesn't delete `SourceVideo`/media. Preserve this guarantee in any change to `syncSource` or download logic.
11. **The MVP only accepts public HTTPS YouTube URLs** on the hosts allow-listed in `lib/youtube/url.ts`. Don't add cookie/auth-based extraction without discussing the security implications (credentials would need to reach a background job process).

## Commands

```bash
npm run dev         # next dev (predev runs prisma generate + migrate deploy)
npm run build        # next build --webpack (prebuild runs prisma generate)
npm start            # next start (prestart runs prisma generate + migrate deploy)
npm test             # vitest run
npm run test:watch   # vitest
npm run typecheck    # tsc --noEmit
npm run db:migrate   # prisma migrate dev (schema development only)
```

Run `npm test` and `npm run typecheck` before considering a change done. There are no component/UI tests in this repo — `tests/` covers `lib/` logic only.

## Schema changes

Edit `prisma/schema.prisma`, then run `npm run db:migrate` to generate a migration under `prisma/migrations/`. Commit the generated SQL. Do not hand-edit committed migration files.

## Docs maintenance

If a change alters routing, data flow, an external integration, the schema, or the build/deploy model, update `docs/ARCHITECTURE.md` in the same change. If it changes a user-facing workflow, update `README.md` and, if relevant, `docs/PRODUCT.md`. Don't let these drift from the code.


## vexp - Context-Aware AI Coding <!-- vexp v3.1.1 -->

### Context strategy: call run_pipeline ONCE at task start
If the task already names the files/symbols to touch, SKIP vexp. Otherwise one
`run_pipeline({ "task": "..." })` returns ranked pivot files with line ranges and
blast radius. Do NOT open files one by one to find your way around - every extra
tool call costs a turn. Call it again ONLY when the task moves to a new area.
`get_skeleton` for files to understand, not edit. `verify_done` before calling a
multi-file task complete, then RUN the tests it names.

### Query shape (do this)
Anchor the task on real identifiers (ClassName, functionName) or file paths:
`run_pipeline({ "task": "fix JWT expiry in AuthService.validateToken" })`

vexp runs entirely on this machine, index in `.vexp/`;
`run_pipeline` transmits nothing to any external service.
On `status: "degraded"` or 0 pivots the index is still building - use your own tools.
For literal string sweeps use your native search - do NOT route text sweeps through vexp.
Repo SOURCE only: logs, dist/, node_modules/ and files outside the repo are NOT indexed.
<!-- /vexp -->