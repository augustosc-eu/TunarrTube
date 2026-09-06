import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { basename } from "node:path";
import { AppError } from "@/lib/api";
import { runProcess } from "@/lib/system/process";

export type BinaryName = "yt-dlp" | "ffmpeg";
export type BinaryStatus = { name: BinaryName; found: boolean; path: string | null; version: string | null; error?: string };
export type BinaryUpdateResult = { name: BinaryName; message: string; version: string | null };

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
  const override = name === "yt-dlp"
    ? process.env.TUNARRTUBE_YTDLP_PATH ?? process.env.YTARR_YTDLP_PATH
    : process.env.TUNARRTUBE_FFMPEG_PATH ?? process.env.YTARR_FFMPEG_PATH;
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

/**
 * yt-dlp ships a self-updater (`--update`); FFmpeg does not, so this only supports yt-dlp.
 * A yt-dlp build installed via a package manager (e.g. Homebrew) refuses to self-update and
 * exits non-zero with guidance to use that package manager instead — that surfaces as an
 * AppError here rather than a silent no-op.
 */
export async function updateBinary(name: BinaryName): Promise<BinaryUpdateResult> {
  if (name !== "yt-dlp") throw new AppError("UPDATE_UNSUPPORTED", `${name} has no self-update; update it with your system package manager.`, 400);
  const path = await discoverBinary(name);
  if (!path) throw new AppError("BINARY_NOT_FOUND", "yt-dlp was not found.", 404);
  const result = await runProcess(path, ["--update"], { timeoutMs: 120_000 });
  const message = result.stdout.trim().split("\n").filter(Boolean).pop() || "yt-dlp is up to date.";
  const status = await inspectBinary(name);
  return { name, message, version: status.version };
}
