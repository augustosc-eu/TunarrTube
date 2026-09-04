# Security policy

## Supported versions

TunarrTube is pre-1.0 software. Security fixes are applied to the latest commit on the default branch; older commits and releases are not supported.

## Deployment boundary

TunarrTube is a single-user, local-first application. **It has no authentication or authorization layer and must not be exposed directly to the public internet or an untrusted LAN.** Its API can start downloads, change writable media paths, and modify a configured Tunarr server.

The supplied Compose configuration publishes TunarrTube and its optional Tunarr service on `127.0.0.1` only. The `npm start` command does the same. If you deliberately bind TunarrTube to another interface, put an authenticating reverse proxy or VPN in front of it and restrict access to trusted users. TLS termination and rate limiting also belong at that boundary.

TunarrTube accepts only public HTTPS YouTube URLs and does not support cookies or account credentials. Never add credentials to YouTube URLs, command-line overrides, logs, issues, or diagnostics.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use the repository host's private security-advisory/reporting feature. If private reporting is not enabled, contact the maintainers privately through the contact method on their profile and include:

- affected commit or version;
- reproduction steps and impact;
- relevant configuration, with secrets and signed URLs removed;
- any suggested mitigation.

Allow the maintainers a reasonable opportunity to investigate and release a fix before public disclosure.

## Operational recommendations

- Run one TunarrTube instance per SQLite database and keep `/config` and media mounts writable only by the container/user that needs them.
- Pin container image tags or digests for reproducible deployments and apply updates regularly.
- Back up the SQLite database and media directory before upgrades.
- Review `npm audit` and container-image scan results before releases.
- Treat the configured Tunarr URL as trusted: TunarrTube sends requests to it and can mutate that Tunarr instance.
