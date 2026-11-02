import { spawn } from "node:child_process";
import { AppError } from "@/lib/api";
import { writeLog } from "@/lib/logging/service";

// Quit from the web UI, for the desktop apps (packaging/launcher/launcher.mjs sets TUNARRTUBE_QUIT_ENABLED):
// it has no terminal window to close or Ctrl+C in. Other installs never offer it -- they're stopped the way
// they were started (Ctrl+C, docker stop, a service manager).
export function quitAvailable() {
  return process.env.TUNARRTUBE_QUIT_ENABLED === "1";
}

const QUIT_DELAY_MS = 300;

export async function requestQuit() {
  if (!quitAvailable()) throw new AppError("QUIT_UNAVAILABLE", "Stop TunarrTube the way it was started (Ctrl+C, docker stop, or your service manager).", 409);
  await writeLog({ category: "system", message: "Quit requested from the web UI." }).catch(() => undefined);
  // After the response is sent. On macOS and Linux the launcher started the server as its own process group
  // leader, so signalling the group also stops any yt-dlp/FFmpeg/Chrome child; Windows has no process groups,
  // so end this process's tree instead. Jobs left running are requeued by lib/jobs/runner.ts's recoverJobs()
  // on the next start, and downloads are temp-then-rename.
  setTimeout(() => {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(process.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => process.exit(0));
      return;
    }
    try {
      process.kill(-process.pid, "SIGTERM");
    } catch {
      process.kill(process.pid, "SIGTERM");
    }
  }, QUIT_DELAY_MS);
  return { quitting: true };
}
