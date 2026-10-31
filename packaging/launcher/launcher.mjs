// Entry point of the portable release (scripts/package-release.mjs builds it; the TunarrTube.cmd /
// TunarrTube.command / tunarrtube scripts next to it start it with the bundled Node.js). It picks the library
// folder (asking the first time), backs up and migrates the database, starts the Next.js standalone server
// with the bundled yt-dlp/FFmpeg/Chromium, and opens the browser. Run with --help for options.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  defaultDataDirectory,
  detectLibrary,
  isInside,
  launcherConfigPath,
  libraryLocation,
  readLauncherConfig,
  samePath,
  selectLibrary,
  serverEnvironment,
  writeLauncherConfig
} from "./library.mjs";
import { chooseFolderWithDialog } from "./picker.mjs";

const bundleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(bundleRoot, "app");
const runtimeDir = path.join(bundleRoot, "runtime");
const toolsDir = path.join(bundleRoot, "tools");
const nodeExecutable = process.execPath;
const version = JSON.parse(readFileSync(path.join(appDir, "package.json"), "utf8")).version;
const BACKUPS_TO_KEEP = 10;

const HELP = `TunarrTube ${version}

Usage: TunarrTube [options]

  --data-dir <folder>   Open the library in <folder> (created if it doesn't exist) and remember it.
  --choose-data-dir     Ask again which folder to use. The previous one is left untouched as a legacy library.
  --port <number>       Port to listen on (default 3000).
  --lan                 Listen on all network interfaces instead of only this computer (127.0.0.1).
  --host <address>      Listen on a specific address.
  --no-open             Don't open the browser once the server is ready.
  --no-dialog           Type folder paths instead of using a folder dialog (e.g. over SSH).
  --version             Print the version and exit.
  --help                Show this help.
`;

const { values: args } = parseArgs({
  options: {
    "data-dir": { type: "string" },
    "choose-data-dir": { type: "boolean" },
    port: { type: "string" },
    lan: { type: "boolean" },
    host: { type: "string" },
    "no-open": { type: "boolean" },
    "no-dialog": { type: "boolean" },
    version: { type: "boolean" },
    help: { type: "boolean" }
  },
  strict: true
});

class LauncherError extends Error {}

const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
let readline;
async function ask(question) {
  readline ??= createInterface({ input: process.stdin, output: process.stdout });
  return (await readline.question(question)).trim();
}

async function menu(title, options) {
  console.log(`\n${title}`);
  options.forEach((option, index) => console.log(`  ${index + 1}) ${option.label}`));
  for (;;) {
    const answer = await ask(`Choose 1-${options.length} [1]: `);
    const index = answer === "" ? 0 : Number.parseInt(answer, 10) - 1;
    if (options[index]) return options[index].value;
  }
}

// A native dialog when there is one, otherwise (or after the dialog is cancelled) a typed path. Returns
// null to go back to the menu.
async function pickFolder(prompt) {
  const picked = args["no-dialog"] ? undefined : chooseFolderWithDialog(prompt);
  if (picked) return path.resolve(picked);
  const typed = await ask(`${picked === null ? "No folder chosen. " : ""}Type the full path of the folder (leave empty to go back): `);
  return typed ? path.resolve(typed.replace(/^["']|["']$/g, "")) : null;
}

function prepareNewLibrary(directory) {
  if (isInside(bundleRoot, directory)) {
    throw new LauncherError(`Choose a folder outside the TunarrTube release folder (${bundleRoot}), so replacing the release with a newer version never removes your library.`);
  }
  mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, `.tunarrtube-write-test-${process.pid}`);
  try {
    writeFileSync(probe, "");
    rmSync(probe);
  } catch {
    throw new LauncherError(`TunarrTube can't write to ${directory}. Choose a folder you own.`);
  }
  return libraryLocation(directory, "data");
}

// Asked when the folder chosen for a *new* library already holds one.
async function confirmExisting(location) {
  console.log(`\n${location.dataDirectory} already holds a TunarrTube library${location.layout === "checkout" ? " (a source checkout)" : ""}.`);
  return menu("What do you want to do?", [
    { label: "Keep using it as it is", value: true },
    { label: "Choose a different, new folder", value: false }
  ]);
}

async function chooseLibraryInteractively(config) {
  const current = config.current ? libraryLocation(config.current.dataDirectory, config.current.layout) : null;
  const fallback = defaultDataDirectory();
  for (;;) {
    const options = [];
    if (current) {
      console.log(`\nTunarrTube currently uses ${current.dataDirectory}.`);
      options.push({ label: "Keep using it", value: { kind: "keep" } });
      options.push({ label: `Choose a new folder (${current.dataDirectory} is left untouched as a legacy library)`, value: { kind: "new" } });
    } else {
      console.log("\nWelcome to TunarrTube. Choose the folder for your library: its database, downloaded media,");
      console.log("thumbnails and caches. Pick a drive with room for your videos.");
      options.push({ label: `Use ${fallback}`, value: { kind: "default" } });
      options.push({ label: "Choose a folder...", value: { kind: "new" } });
    }
    options.push({ label: "Open an existing TunarrTube library (a data folder or a source checkout)...", value: { kind: "existing" } });
    for (const legacy of config.legacy) {
      if (!current || !samePath(legacy.dataDirectory, current.dataDirectory)) options.push({ label: `Switch back to legacy library ${legacy.dataDirectory}`, value: { kind: "legacy", legacy } });
    }
    const choice = await menu("Library folder:", options);
    try {
      if (choice.kind === "keep") return current;
      if (choice.kind === "legacy") {
        const found = detectLibrary(choice.legacy.dataDirectory);
        if (found) return found;
        console.log(`No TunarrTube library found in ${choice.legacy.dataDirectory} any more.`);
        continue;
      }
      if (choice.kind === "existing") {
        const directory = await pickFolder("Choose the folder of your existing TunarrTube library");
        if (!directory) continue;
        const found = detectLibrary(directory);
        if (found) return found;
        console.log(`No TunarrTube library found in ${directory}. Choose the folder that contains tunarrtube.db, or the source checkout with prisma/tunarrtube.db.`);
        continue;
      }
      const directory = choice.kind === "default" ? fallback : await pickFolder("Choose a folder for your TunarrTube library");
      if (!directory) continue;
      const found = detectLibrary(directory);
      if (found) {
        if (await confirmExisting(found)) return found;
        continue;
      }
      return prepareNewLibrary(directory);
    } catch (error) {
      if (!(error instanceof LauncherError)) throw error;
      console.log(error.message);
    }
  }
}

function openRemembered(config) {
  const location = libraryLocation(config.current.dataDirectory, config.current.layout);
  // Never silently start an empty library in place of a missing one (an unplugged drive, a renamed folder).
  if (!existsSync(location.dataDirectory)) {
    throw new LauncherError(`Your TunarrTube library folder ${location.dataDirectory} is missing. Reconnect the drive it is on, or run TunarrTube with --choose-data-dir to pick another folder.`);
  }
  if (location.layout === "checkout" && !existsSync(location.databasePath)) {
    throw new LauncherError(`The source checkout ${location.dataDirectory} no longer has a database at ${location.databasePath}. Run TunarrTube with --choose-data-dir to pick another library.`);
  }
  return location;
}

async function resolveLibrary(configPath) {
  const config = readLauncherConfig(configPath);
  let location;
  if (args["data-dir"]) {
    const directory = path.resolve(args["data-dir"]);
    location = detectLibrary(directory) ?? prepareNewLibrary(directory);
  } else if (config.current && !args["choose-data-dir"]) {
    location = openRemembered(config);
  } else if (interactive) {
    location = await chooseLibraryInteractively(config);
  } else if (args["choose-data-dir"]) {
    throw new LauncherError("--choose-data-dir needs a terminal to ask in. Pass --data-dir <folder> instead.");
  } else {
    const directory = defaultDataDirectory();
    console.log(`No library folder chosen yet and no terminal to ask in; using ${directory}. Pass --data-dir <folder> to use another.`);
    location = detectLibrary(directory) ?? prepareNewLibrary(directory);
  }
  const next = selectLibrary(config, location);
  writeLauncherConfig(configPath, next);
  if (config.current && !samePath(config.current.dataDirectory, location.dataDirectory)) {
    console.log(`Left ${config.current.dataDirectory} untouched as a legacy library. Run with --choose-data-dir to switch back.`);
  }
  return { location, config: next };
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// This app assumes a single running instance per database (AGENTS.md); a second launch of the same library
// just opens the browser on the one already running.
function acquireLock(location, port) {
  const lockPath = path.join(location.dataDirectory, ".tunarrtube.lock");
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      if (lock.pid !== process.pid && processAlive(lock.pid)) return { lockPath, running: lock };
    } catch {
      // unreadable lock: treat as stale
    }
  }
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }));
  return { lockPath, running: null };
}

async function healthy(url) {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

function answering(url) {
  return fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
}

function openBrowser(url) {
  const [program, programArgs] =
    process.platform === "darwin" ? ["open", [url]] :
    process.platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]] :
    ["xdg-open", [url]];
  const child = spawn(program, programArgs, { stdio: "ignore", detached: true });
  child.on("error", () => console.log(`Open ${url} in your browser.`));
  child.unref();
}

function bundledTools() {
  const manifestPath = path.join(toolsDir, "manifest.json");
  if (!existsSync(manifestPath)) return { directory: null };
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const resolve = (relative) => (relative && existsSync(path.join(toolsDir, relative)) ? path.join(toolsDir, relative) : undefined);
  return { directory: toolsDir, ytdlp: resolve(manifest.ytdlp), ffmpeg: resolve(manifest.ffmpeg), ffprobe: resolve(manifest.ffprobe), chromium: resolve(manifest.chromium) ?? systemChromium() };
}

// Chrome for Testing has no Linux arm64 build, so that release has no bundled browser; use the system's.
function systemChromium() {
  if (process.platform !== "linux") return undefined;
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
      const candidate = path.join(directory, name);
      if (directory && existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

// Before a different release than last time opens this library: its migrations may change the database.
// SQLite's online backup API rather than a file copy, so pages still in the WAL file are included.
async function backupBeforeUpgrade(location, lastVersion) {
  if (lastVersion === version) return;
  const databasePath = location.databasePath;
  if (!existsSync(databasePath) || statSync(databasePath).size === 0) return;
  const Database = createRequire(path.join(appDir, "package.json"))("better-sqlite3");
  const backupDir = path.join(path.dirname(databasePath), "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const base = path.basename(databasePath, ".db");
  const target = path.join(backupDir, `${base}-${stamp}.db`);
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }
  const backups = readdirSync(backupDir).filter((name) => name.startsWith(`${base}-`) && name.endsWith(".db")).sort();
  for (const old of backups.slice(0, -BACKUPS_TO_KEEP)) rmSync(path.join(backupDir, old));
  console.log(`Backed up the database to ${target} before opening it with TunarrTube ${version}.`);
}

function runStep(label, scriptArgs, env) {
  const result = spawnSync(nodeExecutable, scriptArgs, { cwd: appDir, env, stdio: "inherit" });
  if (result.status !== 0) throw new LauncherError(`${label} failed (exit code ${result.status ?? "unknown"}). See the output above.`);
}

function migrate(location, env) {
  mkdirSync(path.dirname(location.databasePath), { recursive: true });
  runStep("Renaming the legacy database", [path.join(appDir, "scripts", "migrate-legacy-database.mjs")], env);
  if (!existsSync(location.databasePath)) closeSync(openSync(location.databasePath, "a"));
  const prismaCli = path.join(appDir, "prisma-cli", "node_modules", "prisma", "build", "index.js");
  runStep("Updating the database", [prismaCli, "migrate", "deploy", "--config", path.join(appDir, "prisma-cli", "prisma.config.mjs")], env);
}

async function main() {
  if (args.help) return void console.log(HELP);
  if (args.version) return void console.log(version);
  const port = Number.parseInt(args.port ?? process.env.PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new LauncherError(`--port must be a number from 1 to 65535.`);
  const host = args.host ?? (args.lan ? "0.0.0.0" : "127.0.0.1");
  const url = `http://${host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host.includes(":") ? `[${host}]` : host}:${port}`;

  const configPath = launcherConfigPath();
  const { location, config } = await resolveLibrary(configPath);
  readline?.close();
  mkdirSync(location.storageDirectory, { recursive: true });

  const lock = acquireLock(location, port);
  if (lock.running) {
    const runningUrl = `http://127.0.0.1:${lock.running.port}`;
    console.log(`TunarrTube is already running for ${location.dataDirectory} at ${runningUrl}.`);
    if (!args["no-open"]) openBrowser(runningUrl);
    return;
  }
  const releaseLock = () => rmSync(lock.lockPath, { force: true });
  try {
    if (await answering(url)) throw new LauncherError(`Something is already listening on port ${port}. Start TunarrTube with --port <number> to use another port.`);
    const env = serverEnvironment({ baseEnv: process.env, location, appDir, runtimeDir, tools: bundledTools(), host, port });
    await backupBeforeUpgrade(location, config.lastVersion);
    migrate(location, env);
    writeLauncherConfig(configPath, { ...config, lastVersion: version });
    await serve(env, url);
  } finally {
    releaseLock();
  }
}

function serve(env, url) {
  return new Promise((resolve, reject) => {
    const server = spawn(nodeExecutable, [path.join(appDir, "server.js")], { cwd: appDir, env, stdio: "inherit" });
    const forward = (signal) => () => server.kill(signal);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, forward(signal));
    server.on("error", (error) => reject(new LauncherError(`Could not start the server: ${error.message}`)));
    server.on("exit", (code, signal) => {
      process.exitCode = code ?? (signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1);
      resolve();
    });
    (async () => {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline && server.exitCode === null) {
        if (await healthy(url)) {
          console.log(`\nTunarrTube ${version} is running at ${url}`);
          console.log(`Library: ${env.TUNARRTUBE_DATA_DIR}`);
          console.log("Keep this window open while you use TunarrTube. Press Ctrl+C to stop it.\n");
          if (!args["no-open"]) openBrowser(url);
          return;
        }
        await new Promise((done) => setTimeout(done, 500));
      }
      if (server.exitCode === null) console.log(`TunarrTube hasn't answered at ${url} yet; see the output above.`);
    })();
  });
}

main().catch((error) => {
  readline?.close();
  // Ctrl+C or Ctrl+D at a prompt.
  if (error?.name === "AbortError") console.error("\nCancelled.");
  else console.error(`\n${error instanceof LauncherError ? error.message : error?.stack ?? error}`);
  process.exitCode = 1;
});
