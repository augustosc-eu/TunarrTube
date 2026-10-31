#!/bin/sh
# Starts TunarrTube from the portable release (macOS): double-click it, or run it from Terminal.
# Options: ./TunarrTube.command --help
DIR="$(cd "$(dirname "$0")" && pwd)"
# The release isn't code-signed, so macOS quarantines everything a browser downloads and then refuses to run
# the bundled tools. Once you've chosen to open this script, clear that flag for the rest of this folder.
xattr -dr com.apple.quarantine "$DIR" 2>/dev/null || true
exec "$DIR/runtime/node" "$DIR/launcher/launcher.mjs" "$@"
