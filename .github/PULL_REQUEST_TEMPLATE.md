## Summary

<!-- What does this change do, and why? Link related issues (e.g. "Closes #123"). -->

## Changes

<!-- Bullet the notable changes. Call out schema, routing, or integration changes explicitly. -->

## Testing

<!-- Commands run and their result. -->

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run build`

## Checklist

- [ ] Business logic lives in `lib/<domain>/service.ts`; API routes stay thin (parse with zod → call service → `ok()`/`toErrorResponse()`).
- [ ] New/changed request bodies are validated in `lib/validation.ts`.
- [ ] Expected failures throw `AppError`, not ad-hoc error shapes.
- [ ] Responses containing `BigInt` (e.g. `fileSize`) are wrapped in `serialize()`.
- [ ] Filesystem writes built from user/DB-derived paths go through `assertWithinDirectory`.
- [ ] Downloads/writes follow temp-then-rename; no job can leave a half-written file recorded as complete.
- [ ] Slow/background work is enqueued via `enqueueUniqueJob` + `kickWorker()`, not run inline in a request handler.
- [ ] Logged values (errors, process output) are sanitized with `sanitizeLogValue` — no raw yt-dlp stderr or signed stream URLs.
- [ ] Added/changed a Prisma migration under `prisma/migrations/` for any schema change (no hand-edited migrations).
- [ ] Updated `docs/ARCHITECTURE.md` if this changes routing, data flow, an integration, the schema, or build/deploy.
- [ ] Updated `README.md` (and `docs/PRODUCT.md` if relevant) for any user-facing workflow change.
- [ ] No credentials, signed video URLs, personal media, databases, or private logs included in this PR.

## Screenshots / recordings

<!-- If this touches UI, include before/after. Delete this section otherwise. -->
