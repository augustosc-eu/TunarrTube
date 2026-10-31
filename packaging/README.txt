TunarrTube {{version}} ({{target}})
=====================================

This folder is a complete, portable TunarrTube: Node.js, yt-dlp, FFmpeg/ffprobe and a headless
Chrome for Channels overlays are all inside it. Nothing else needs to be installed.

Start it
--------
  Windows:  double-click TunarrTube.cmd
  macOS:    double-click TunarrTube.command
  Linux:    run ./tunarrtube in a terminal

The first time, TunarrTube asks which folder to keep your library in (its database, downloaded
media, thumbnails and caches). Pick a drive with room for your videos, and keep it outside this
folder so that upgrading never touches it. If you already run TunarrTube from a source checkout,
choose "Open an existing TunarrTube library" and select that checkout's folder to keep using it.

Your browser opens on http://127.0.0.1:3000 once TunarrTube is ready. Keep the window open while
you use it; close the window or press Ctrl+C to stop it.

The release isn't code-signed yet, so the first launch needs one extra step:
  Windows:  if SmartScreen says "Windows protected your PC", click "More info", then "Run anyway".
  macOS:    if macOS says the script "cannot be opened", open System Settings > Privacy & Security
            and click "Open Anyway" for TunarrTube.command, or run this once in Terminal:
              xattr -dr com.apple.quarantine /path/to/this/folder

Options
-------
  --choose-data-dir     Pick a different library folder. The current one is left untouched as a
                        legacy library, and you can switch back to it the same way.
  --data-dir <folder>   Use <folder> without asking.
  --port <number>       Listen on another port (default 3000).
  --lan                 Let other devices on your network open TunarrTube. Set a password first:
                        add TUNARRTUBE_AUTH_PASSWORD=... to tunarrtube.env in your library folder.
  --no-open             Don't open the browser.
  --help                All options.

Windows: run them from a terminal, e.g.  TunarrTube.cmd --choose-data-dir

Settings that TunarrTube reads from the environment (TUNARRTUBE_TUNARR_URL, TUNARRTUBE_AUTH_PASSWORD,
...; see the README linked below) can go in a tunarrtube.env file in your library folder, one
NAME=value per line.

Upgrade
-------
Download the new release, close TunarrTube, and replace this folder with the new one. Your library
folder isn't inside it, so nothing is lost, and TunarrTube backs up the database (into the library's
backups/ folder) before a new version first opens it.

More: https://github.com/augustosc-eu/TunarrTube#portable-release-windows-macos-linux
