// Standalone ffprobe discovery, deliberately not folded into lib/system/binaries.ts's
// BinaryName union ("yt-dlp" | "ffmpeg") -- ffprobe is only needed by the render pipeline
// (lib/ffmpeg/probe.ts), so this keeps that existing, shared file untouched. Mirrors its
// discovery strategy: env override, then `which`, then a hardcoded fallback list.
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { basename } from "node:path";
import { AppError } from "@/lib/api";
import { runProcess } from "@/lib/system/process";

export type FfprobeStatus = { found: boolean; path: string | null; version: string | null; error?: string };

const ENV_OVERRIDE = "YTARR_FFPROBE_PATH";
const FALLBACKS = ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "/usr/bin/ffprobe"];

async function executable(candidate: string) {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function discoverFfprobe(): Promise<string | null> {
  const override = process.env[ENV_OVERRIDE];
  if (override && (await executable(override))) return override;
  try {
    const result = await runProcess("which", ["ffprobe"], { timeoutMs: 5000 });
    const candidate = result.stdout.trim().split("\n")[0];
    if (candidate && (await executable(candidate))) return candidate;
  } catch {}
  for (const candidate of FALLBACKS) if (await executable(candidate)) return candidate;
  return null;
}

export async function requireFfprobe(): Promise<string> {
  const path = await discoverFfprobe();
  if (!path) throw new AppError("BINARY_NOT_FOUND", `ffprobe was not found on this machine. Install it or set ${ENV_OVERRIDE}.`, 500);
  return path;
}

export async function inspectFfprobe(): Promise<FfprobeStatus> {
  const path = await discoverFfprobe();
  if (!path) return { found: false, path: null, version: null, error: "ffprobe was not found." };
  try {
    const result = await runProcess(path, ["-version"], { timeoutMs: 30_000 });
    return { found: true, path, version: result.stdout.trim().split("\n")[0] || basename(path) };
  } catch (error) {
    return { found: true, path, version: null, error: error instanceof Error ? error.message : String(error) };
  }
}
