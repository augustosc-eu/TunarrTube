#!/bin/sh
# Starts TunarrTube from the portable release (macOS) in a Terminal window -- the same launcher as
# TunarrTube.app, for its command-line options: ./TunarrTube.command --help
DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES="$DIR/TunarrTube.app/Contents/Resources"
[ -d "$RESOURCES" ] || RESOURCES="$DIR"
# The release isn't code-signed, so macOS quarantines everything a browser downloads and then refuses to run
# the bundled tools. Once you've chosen to open this script, clear that flag for the rest of this folder (only
# when it's there: walking every file takes minutes on a slow drive).
if xattr -p com.apple.quarantine "$DIR" >/dev/null 2>&1 || xattr -p com.apple.quarantine "$0" >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$DIR" 2>/dev/null || true
fi
exec "$RESOURCES/runtime/node" "$RESOURCES/launcher/launcher.mjs" "$@"
