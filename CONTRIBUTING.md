# Contributing to YTarr

Thanks for helping improve YTarr. For substantial changes, open an issue first so the approach and product scope can be agreed before implementation.

## Development setup

Install Node.js 22 or newer, `yt-dlp`, and FFmpeg, then run:

```bash
npm install
npm run dev
```

See [README.md](README.md) for OS-specific prerequisites and configuration. The local SQLite database and downloaded media are ignored by Git.

## Before submitting a change

```bash
npm test
npm run typecheck
npm run build
```

Keep API routes thin, validate request bodies in `lib/validation.ts`, and put behavior in the relevant `lib/<domain>/service.ts`. Use `AppError` for expected failures, `serialize()` for responses containing `BigInt`, and `assertWithinDirectory()` before filesystem writes derived from user or database values.

Update `README.md` for user-facing behavior and `docs/ARCHITECTURE.md` for changes to routing, integrations, persistence, schema, or deployment. Add a committed Prisma migration for schema changes.

## Security and privacy

Read [SECURITY.md](SECURITY.md). Do not include credentials, signed video URLs, personal media, databases, or logs containing private data in an issue or pull request.
