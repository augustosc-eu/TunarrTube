# Contributing to TunarrTube

Thanks for helping improve TunarrTube. For substantial changes, open an issue first so the approach and product scope can be agreed before implementation.

By participating in this project you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

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

## Releasing (maintainers)

1. Make sure `main` is green in CI.
2. Set `version` in `package.json` and rename the `# Unreleased` heading in `RELEASE_NOTES.md` to the new version, then commit.
3. Tag and push: `git tag v0.3.0 && git push origin v0.3.0`. A pre-release uses a suffix, such as `v0.3.0-rc.1`.
4. The **Docker image** workflow builds `linux/amd64` and `linux/arm64` and publishes `ghcr.io/augustosc-eu/tunarrtube` with the tags described in README's "Published images". Check its run summary for the pull command.
5. Create the GitHub Release from the tag, using the release-notes section as its description.

The first time an image is published, check the package's visibility under the repository's **Packages** settings; it may need to be made public before others can pull it.

## Security and privacy

Read [SECURITY.md](SECURITY.md). Do not include credentials, signed video URLs, personal media, databases, or logs containing private data in an issue or pull request.
