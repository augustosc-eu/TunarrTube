import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { basename } from "node:path";
import { AppError } from "@/lib/api";
import { readEnv } from "@/lib/config/env";
import { runProcess } from "@/lib/system/process";

export type BinaryName = "yt-dlp" | "ffmpeg";
export type BinaryStatus = { name: BinaryName; found: boolean; path: string | null; version: string | null; error?: string };
export type BinaryUpdateResult = { name: BinaryName; message: string; version: string | null; updated: boolean };

const fallbacks: Record<BinaryName, string[]> = {
  "yt-dlp": ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", "/usr/bin/yt-dlp"],
  ffmpeg: ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]
};

async function executable(candidate: string) {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function discoverBinary(name: BinaryName): Promise<string | null> {
  const override = readEnv(name === "yt-dlp" ? "YTDLP_PATH" : "FFMPEG_PATH");
  if (override && (await executable(override))) return override;
  try {
    const result = await runProcess("which", [name], { timeoutMs: 5000 });
    const candidate = result.stdout.trim().split("\n")[0];
    if (candidate && (await executable(candidate))) return candidate;
  } catch {}
  for (const candidate of fallbacks[name]) if (await executable(candidate)) return candidate;
  return null;
}

export async function inspectBinary(name: BinaryName): Promise<BinaryStatus> {
  const path = await discoverBinary(name);
  if (!path) return { name, found: false, path: null, version: null, error: `${name} was not found.` };
  try {
    const result = await runProcess(path, [name === "ffmpeg" ? "-version" : "--version"], { timeoutMs: 30_000 });
    return { name, found: true, path, version: result.stdout.trim().split("\n")[0] || basename(path) };
  } catch (error) {
    return { name, found: true, path, version: null, error: error instanceof Error ? error.message : String(error) };
  }
}

// The reasons yt-dlp gives (yt_dlp/update.py's _NON_UPDATEABLE_REASONS, or a packager's UPDATE_HINT
// such as PyPI's "You installed yt-dlp with pip ...; Use that to update") when its own build can't
// replace itself. Homebrew packages yt-dlp from the PyPI wheel, so a Homebrew install reports the pip
// hint -- misleading on its own, hence the rewrite below.
const SELF_UPDATE_REFUSED = /Use that to update|Re-download the latest release|cannot be updated|Use git to pull|Build the executable again/i;

async function selfUpdateRefusedError(path: string, message: string) {
  const resolved = await realpath(path).catch(() => path);
  const reason = message.match(/ERROR:\s*(.+)/)?.[1]?.trim() ?? message;
  if (/\/Cellar\/yt-dlp\//.test(resolved)) {
    return new AppError("YTDLP_SELF_UPDATE_UNSUPPORTED", `This yt-dlp (${path}) was installed with Homebrew, which doesn't let it update itself. Run \`brew upgrade yt-dlp\` on this machine, then test yt-dlp again.`, 409, { path, reason });
  }
  return new AppError("YTDLP_SELF_UPDATE_UNSUPPORTED", `This yt-dlp (${path}) can't update itself: ${reason}. Update it the way it was installed, or set TUNARRTUBE_YTDLP_PATH to a standalone yt-dlp release binary, which can.`, 409, { path, reason });
}

/**
 * yt-dlp ships a self-updater (`--update`); FFmpeg does not, so this only supports yt-dlp.
 * A yt-dlp build installed via a package manager (Homebrew, pip, a distro package) refuses to
 * self-update and exits non-zero with guidance to use that package manager instead — that surfaces
 * as a YTDLP_SELF_UPDATE_UNSUPPORTED AppError naming the command to run, rather than a silent no-op.
 * The Docker image's yt-dlp (scripts/install-ytdlp.py) is a standalone build that can.
 */
export async function updateBinary(name: BinaryName): Promise<BinaryUpdateResult> {
  if (name !== "yt-dlp") throw new AppError("UPDATE_UNSUPPORTED", `${name} has no self-update; update it with your system package manager.`, 400);
  const path = await discoverBinary(name);
  if (!path) throw new AppError("BINARY_NOT_FOUND", "yt-dlp was not found.", 404);
  const before = await inspectBinary(name);
  try {
    await runProcess(path, ["--update"], { timeoutMs: 120_000 });
  } catch (error) {
    if (error instanceof AppError && error.code === "PROCESS_FAILED" && SELF_UPDATE_REFUSED.test(error.message)) throw await selfUpdateRefusedError(path, error.message);
    throw error;
  }
  const after = await inspectBinary(name);
  const updated = Boolean(after.version && before.version && after.version !== before.version);
  const message = updated
    ? `Updated yt-dlp from ${before.version} to ${after.version}.`
    : `yt-dlp is already up to date${after.version ? ` (${after.version})` : ""}.`;
  return { name, message, version: after.version, updated };
}
