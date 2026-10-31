// Pure helpers for the portable release's launcher (launcher.mjs): where a TunarrTube library lives, how
// the launcher remembers the operator's choice, and the environment the server is started with. Kept free
// of prompts and process spawning so tests/launcher-library.test.ts can exercise them directly.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

export const DATABASE_FILENAME = "tunarrtube.db";
const LEGACY_DATABASE_FILENAME = "ytarr.db";
// A data folder's own optional settings file (TUNARRTUBE_TUNARR_URL, TUNARRTUBE_AUTH_PASSWORD, ...). A source
// checkout keeps using its existing .env instead.
export const DATA_ENV_FILENAME = "tunarrtube.env";
const CONFIG_VERSION = 1;

/**
 * A library is one of two layouts:
 * - "data": a folder the launcher manages -- <dir>/tunarrtube.db plus <dir>/storage/.
 * - "checkout": a TunarrTube source checkout run with `npm start` -- <dir>/prisma/tunarrtube.db (or wherever
 *   its .env's DATABASE_URL points) plus <dir>/storage/. Opened in place so an existing install keeps working.
 */
export function libraryLocation(directory, layout) {
  const dataDirectory = path.resolve(directory);
  const storageDirectory = path.join(dataDirectory, "storage");
  if (layout === "checkout") {
    const envFile = path.join(dataDirectory, ".env");
    const configured = readEnvFile(envFile).DATABASE_URL;
    return { layout, dataDirectory, storageDirectory, envFile, databasePath: resolveCheckoutDatabase(dataDirectory, configured) };
  }
  return { layout: "data", dataDirectory, storageDirectory, envFile: path.join(dataDirectory, DATA_ENV_FILENAME), databasePath: path.join(dataDirectory, DATABASE_FILENAME) };
}

// Same rule as scripts/migrate-legacy-database.mjs:resolveDatabasePath -- relative file: URLs resolve against
// prisma/. A non-file URL can't be a checkout's SQLite database, so fall back to the default.
function resolveCheckoutDatabase(directory, url) {
  const configured = url?.startsWith("file:") ? url.slice(5) : `./${DATABASE_FILENAME}`;
  return path.isAbsolute(configured) ? configured : path.resolve(directory, "prisma", configured);
}

function hasDatabase(filePath) {
  for (const candidate of [filePath, path.join(path.dirname(filePath), LEGACY_DATABASE_FILENAME)]) {
    if (existsSync(candidate) && statSync(candidate).isFile() && statSync(candidate).size > 0) return true;
  }
  return false;
}

function isCheckout(directory) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
    return pkg.name === "tunarrtube" && existsSync(path.join(directory, "prisma", "schema.prisma"));
  } catch {
    return false;
  }
}

/** The existing library in `directory`, or null when it holds none (an empty or unrelated folder). */
export function detectLibrary(directory) {
  const dataDirectory = path.resolve(directory);
  if (!existsSync(dataDirectory) || !statSync(dataDirectory).isDirectory()) return null;
  const data = libraryLocation(dataDirectory, "data");
  if (hasDatabase(data.databasePath)) return data;
  if (isCheckout(dataDirectory)) {
    const checkout = libraryLocation(dataDirectory, "checkout");
    if (hasDatabase(checkout.databasePath)) return checkout;
  }
  return null;
}

export function defaultDataDirectory(home = os.homedir()) {
  return path.join(home, "TunarrTube");
}

// Where the launcher remembers which library to open: the per-user config directory, never the release
// folder, so replacing the release with a newer one keeps the choice.
export function launcherConfigPath(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "TunarrTube", "launcher.json");
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "TunarrTube", "launcher.json");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "tunarrtube", "launcher.json");
}

/** { current: { dataDirectory, layout } | null, legacy: [{ dataDirectory, layout, retiredAt }], lastVersion } */
export function readLauncherConfig(configPath) {
  const empty = { version: CONFIG_VERSION, current: null, legacy: [], lastVersion: null };
  if (!existsSync(configPath)) return empty;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return { ...empty, ...parsed, legacy: Array.isArray(parsed.legacy) ? parsed.legacy : [] };
  } catch {
    throw new Error(`Could not read ${configPath}. Fix or delete it, then start TunarrTube again.`);
  }
}

export function writeLauncherConfig(configPath, config) {
  mkdirSync(path.dirname(configPath), { recursive: true });
  const temp = `${configPath}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ ...config, version: CONFIG_VERSION }, null, 2)}\n`);
  renameSync(temp, configPath);
}

/**
 * Makes `location` the library the launcher opens. A different previous library is kept in `legacy`,
 * untouched on disk, so the operator can switch back with --choose-data-dir; choosing a legacy library
 * again takes it off that list.
 */
export function selectLibrary(config, location) {
  const entry = { dataDirectory: location.dataDirectory, layout: location.layout };
  const same = (other) => other && samePath(other.dataDirectory, entry.dataDirectory);
  const legacy = config.legacy.filter((item) => !same(item));
  if (config.current && !same(config.current)) legacy.unshift({ ...config.current, retiredAt: new Date().toISOString() });
  return { ...config, current: entry, legacy };
}

export function samePath(a, b, platform = process.platform) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return platform === "win32" || platform === "darwin" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function readEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) return {};
  return parseEnv(readFileSync(filePath, "utf8"));
}

function pathKey(env) {
  return Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
}

// Both spellings count: readEnv (lib/config/env.ts) still honors the pre-rename YTARR_ names.
function isSet(env, suffix) {
  return Boolean(env[`TUNARRTUBE_${suffix}`] || env[`YTARR_${suffix}`]);
}

/**
 * The server's environment. Precedence, highest first: the launcher's own process environment, then the
 * library's env file, then the launcher's defaults (bundled tools, data paths). The bundled Node.js and
 * tools directories go first on PATH: yt-dlp finds its JavaScript runtime (`--js-runtimes node`, see
 * lib/youtube/ytdlp.ts) and FFmpeg there.
 */
export function serverEnvironment({ baseEnv, location, appDir, runtimeDir, tools, host, port }) {
  const env = { ...readEnvFile(location.envFile), ...baseEnv };
  env.NODE_ENV = "production";
  env.NEXT_TELEMETRY_DISABLED ??= "1";
  env.HOSTNAME = host;
  env.PORT = String(port);
  env.TUNARRTUBE_DATA_DIR = location.dataDirectory;
  env.TUNARRTUBE_STORAGE_DIR = location.storageDirectory;
  env.DATABASE_URL = `file:${location.databasePath.replaceAll("\\", "/")}`;
  env.TUNARRTUBE_APP_DIR = appDir;
  const defaults = { YTDLP_PATH: tools.ytdlp, FFMPEG_PATH: tools.ffmpeg, FFPROBE_PATH: tools.ffprobe, PUPPETEER_EXECUTABLE_PATH: tools.chromium };
  for (const [suffix, value] of Object.entries(defaults)) {
    if (value && !isSet(env, suffix)) env[`TUNARRTUBE_${suffix}`] = value;
  }
  const key = pathKey(env);
  const extra = [runtimeDir, tools.directory].filter(Boolean);
  env[key] = [...extra, ...(env[key] ? [env[key]] : [])].join(path.delimiter);
  return env;
}
