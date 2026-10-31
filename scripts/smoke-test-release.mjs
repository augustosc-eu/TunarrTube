// Smoke-tests a packaged portable release (scripts/package-release.mjs output) the way an operator runs it:
//
//   node scripts/smoke-test-release.mjs dist/TunarrTube-<version>-<target>
//
// Starts the launcher with the bundled Node.js against a throwaway library folder (and a throwaway home, so
// the operator's real launcher.json is never touched), waits for /api/health, checks the app finds the
// bundled yt-dlp and FFmpeg, renders a page with the bundled Chrome Headless Shell, then stops it again.
// Used by .github/workflows/release-binaries.yml on every target.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const release = path.resolve(process.argv[2] ?? "");
if (!existsSync(path.join(release, "launcher", "launcher.mjs"))) {
  console.error("Usage: node scripts/smoke-test-release.mjs <unpacked release folder>");
  process.exit(1);
}
const windows = process.platform === "win32";
const node = path.join(release, "runtime", windows ? "node.exe" : "node");
const scratch = mkdtempSync(path.join(os.tmpdir(), "tunarrtube-smoke-"));
const library = path.join(scratch, "library");
const port = 39_000 + Math.floor(Math.random() * 1000);
const url = `http://127.0.0.1:${port}`;
const env = { ...process.env, HOME: scratch, USERPROFILE: scratch, APPDATA: path.join(scratch, "AppData"), XDG_CONFIG_HOME: path.join(scratch, ".config") };

let launcher;
function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (launcher.exitCode !== null) throw new Error(`The launcher exited early with code ${launcher.exitCode}.`);
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url}/api/health didn't become ready within 2 minutes.`);
}

async function binary(name) {
  const response = await fetch(`${url}/api/system/test-${name}`, { method: "POST" });
  return (await response.json()).data;
}

async function renderWithBundledChrome() {
  const manifest = JSON.parse(readFileSync(path.join(release, "tools", "manifest.json"), "utf8"));
  if (!manifest.chromium) return console.log("skip - no bundled Chrome Headless Shell for this target");
  const puppeteer = createRequire(path.join(release, "app", "package.json"))("puppeteer");
  const browser = await puppeteer.launch({ headless: true, executablePath: path.join(release, "tools", manifest.chromium), args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent("<h1>TunarrTube</h1>");
    check((await page.screenshot()).length > 0, "bundled Chrome Headless Shell renders a page");
  } finally {
    await browser.close();
  }
}

function stop() {
  if (!launcher || launcher.exitCode !== null) return Promise.resolve();
  const exited = new Promise((resolve) => launcher.once("exit", resolve));
  // Windows has no SIGINT for a child without a console; end the whole tree (launcher and server).
  if (windows) spawnSync("taskkill", ["/pid", String(launcher.pid), "/T", "/F"], { stdio: "ignore" });
  else launcher.kill("SIGINT");
  return exited;
}

try {
  launcher = spawn(node, [path.join(release, "launcher", "launcher.mjs"), "--data-dir", library, "--port", String(port), "--no-open"], { env, stdio: ["ignore", "inherit", "inherit"] });
  await waitForHealth();
  check(true, `server is healthy at ${url}`);
  check(existsSync(path.join(library, "tunarrtube.db")), "the database was created in the chosen library folder");
  const ytdlp = await binary("ytdlp");
  check(ytdlp.found && ytdlp.path.startsWith(release), `the app uses the bundled yt-dlp (${ytdlp.version})`);
  const ffmpeg = await binary("ffmpeg");
  check(ffmpeg.found && ffmpeg.path.startsWith(release), `the app uses the bundled FFmpeg (${ffmpeg.version})`);
  await renderWithBundledChrome();
  await stop();
  if (!windows) check(!existsSync(path.join(library, ".tunarrtube.lock")), "stopping the launcher releases its lock");
} catch (error) {
  await stop();
  console.error(`not ok - ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
}
