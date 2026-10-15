#!/usr/bin/env python3
"""Installs yt-dlp's official zipimport release for the Docker image (see Dockerfile).

The zipimport build (a single Python zip app) supports `yt-dlp --update`, unlike a pip install, so
Settings -> Update keeps working inside the container as long as the non-root app user owns the file.
Checked against the same release's SHA2-256SUMS so a truncated or corrupted download fails the build.

Usage: install-ytdlp.py <destination-file>
"""
import hashlib
import os
import sys
import urllib.request

RELEASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download"
ASSET = "yt-dlp"


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: install-ytdlp.py <destination-file>")
    destination = sys.argv[1]
    sums = fetch(f"{RELEASE}/SHA2-256SUMS").decode()
    expected = next((line.split()[0] for line in sums.splitlines() if line.split()[-1:] == [ASSET]), None)
    if not expected:
        sys.exit(f"{ASSET} is not listed in SHA2-256SUMS")
    payload = fetch(f"{RELEASE}/{ASSET}")
    actual = hashlib.sha256(payload).hexdigest()
    if actual != expected:
        sys.exit(f"checksum mismatch for {ASSET}: expected {expected}, got {actual}")
    os.makedirs(os.path.dirname(destination) or ".", exist_ok=True)
    temporary = f"{destination}.tmp"
    with open(temporary, "wb") as handle:
        handle.write(payload)
    os.chmod(temporary, 0o755)
    os.replace(temporary, destination)
    print(f"installed {ASSET} ({actual[:12]}) to {destination}")


if __name__ == "__main__":
    main()
