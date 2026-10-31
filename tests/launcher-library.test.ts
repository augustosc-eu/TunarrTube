import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectLibrary,
  isInside,
  launcherConfigPath,
  libraryLocation,
  readLauncherConfig,
  selectLibrary,
  serverEnvironment,
  writeLauncherConfig,
  type LauncherConfig
} from "../packaging/launcher/library.mjs";
import { configuredDatabaseUrl } from "../scripts/migrate-legacy-database.mjs";

const cleanup: string[] = [];

afterEach(() => {
  for (const directory of cleanup.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempDir() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tunarrtube-launcher-test-"));
  cleanup.push(directory);
  return directory;
}

function fakeCheckout(root: string, databaseRelative = path.join("prisma", "tunarrtube.db")) {
  mkdirSync(path.join(root, "prisma"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "tunarrtube" }));
  writeFileSync(path.join(root, "prisma", "schema.prisma"), "");
  mkdirSync(path.dirname(path.join(root, databaseRelative)), { recursive: true });
  writeFileSync(path.join(root, databaseRelative), "SQLite format 3");
}

const emptyConfig: LauncherConfig = { version: 1, current: null, legacy: [], lastVersion: null };

describe("detectLibrary", () => {
  it("finds nothing in an empty or missing folder", () => {
    const root = tempDir();
    expect(detectLibrary(root)).toBeNull();
    expect(detectLibrary(path.join(root, "missing"))).toBeNull();
  });

  it("finds a data folder by its database, and ignores an empty placeholder file", () => {
    const root = tempDir();
    writeFileSync(path.join(root, "tunarrtube.db"), "");
    expect(detectLibrary(root)).toBeNull();
    writeFileSync(path.join(root, "tunarrtube.db"), "SQLite format 3");
    expect(detectLibrary(root)).toMatchObject({ layout: "data", databasePath: path.join(root, "tunarrtube.db"), storageDirectory: path.join(root, "storage") });
  });

  it("finds a data folder that still has the pre-rename ytarr.db", () => {
    const root = tempDir();
    writeFileSync(path.join(root, "ytarr.db"), "SQLite format 3");
    expect(detectLibrary(root)).toMatchObject({ layout: "data", databasePath: path.join(root, "tunarrtube.db") });
  });

  it("opens a source checkout in place, at prisma/tunarrtube.db and storage/", () => {
    const root = tempDir();
    fakeCheckout(root);
    expect(detectLibrary(root)).toMatchObject({
      layout: "checkout",
      databasePath: path.join(root, "prisma", "tunarrtube.db"),
      storageDirectory: path.join(root, "storage"),
      envFile: path.join(root, ".env")
    });
  });

  it("follows a checkout's .env DATABASE_URL, resolving it against prisma/ like the app does", () => {
    const root = tempDir();
    fakeCheckout(root, path.join("data", "library.db"));
    writeFileSync(path.join(root, ".env"), "DATABASE_URL=file:../data/library.db\n");
    expect(detectLibrary(root)?.databasePath).toBe(path.join(root, "data", "library.db"));
  });

  it("doesn't mistake another project with a prisma/ database for a checkout", () => {
    const root = tempDir();
    fakeCheckout(root);
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "something-else" }));
    expect(detectLibrary(root)).toBeNull();
  });
});

describe("selectLibrary", () => {
  it("keeps the previous library as a legacy entry instead of forgetting it", () => {
    const first = libraryLocation("/libraries/old", "data");
    const second = libraryLocation("/libraries/new", "data");
    const config = selectLibrary(selectLibrary(emptyConfig, first), second);
    expect(config.current).toEqual({ dataDirectory: path.resolve("/libraries/new"), layout: "data" });
    expect(config.legacy).toEqual([expect.objectContaining({ dataDirectory: path.resolve("/libraries/old"), layout: "data", retiredAt: expect.any(String) })]);
  });

  it("takes a library off the legacy list when it's chosen again, and doesn't list the current one", () => {
    const old = libraryLocation("/libraries/old", "data");
    const next = libraryLocation("/libraries/new", "data");
    const back = selectLibrary(selectLibrary(selectLibrary(emptyConfig, old), next), old);
    expect(back.current?.dataDirectory).toBe(path.resolve("/libraries/old"));
    expect(back.legacy.map((entry) => entry.dataDirectory)).toEqual([path.resolve("/libraries/new")]);
    expect(selectLibrary(back, old).legacy).toHaveLength(1);
  });
});

describe("launcher config", () => {
  it("lives in each platform's per-user config folder", () => {
    expect(launcherConfigPath("win32", { APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "C:\\Users\\a")).toBe(path.join("C:\\Users\\a\\AppData\\Roaming", "TunarrTube", "launcher.json"));
    expect(launcherConfigPath("darwin", {}, "/Users/a")).toBe(path.join("/Users/a", "Library", "Application Support", "TunarrTube", "launcher.json"));
    expect(launcherConfigPath("linux", { XDG_CONFIG_HOME: "/cfg" }, "/home/a")).toBe(path.join("/cfg", "tunarrtube", "launcher.json"));
    expect(launcherConfigPath("linux", {}, "/home/a")).toBe(path.join("/home/a", ".config", "tunarrtube", "launcher.json"));
  });

  it("round-trips, and reads a missing file as no choice yet", () => {
    const file = path.join(tempDir(), "nested", "launcher.json");
    expect(readLauncherConfig(file)).toEqual(emptyConfig);
    const config = selectLibrary(emptyConfig, libraryLocation("/libraries/one", "data"));
    writeLauncherConfig(file, config);
    expect(readLauncherConfig(file)).toEqual(config);
  });

  it("refuses to guess past a corrupt file", () => {
    const file = path.join(tempDir(), "launcher.json");
    writeFileSync(file, "{not json");
    expect(() => readLauncherConfig(file)).toThrow(/Fix or delete it/);
  });
});

describe("serverEnvironment", () => {
  const tools = { directory: "/release/tools", ytdlp: "/release/tools/yt-dlp", ffmpeg: "/release/tools/ffmpeg", ffprobe: "/release/tools/ffprobe", chromium: "/release/tools/chrome" };
  const base = { appDir: "/release/app", runtimeDir: "/release/runtime", tools, host: "127.0.0.1", port: 3000 };

  it("points the app at the library and the bundled tools, with the bundled Node.js first on PATH", () => {
    const location = libraryLocation(tempDir(), "data");
    const env = serverEnvironment({ ...base, baseEnv: { PATH: "/usr/bin" }, location });
    expect(env).toMatchObject({
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: "3000",
      TUNARRTUBE_DATA_DIR: location.dataDirectory,
      TUNARRTUBE_STORAGE_DIR: location.storageDirectory,
      DATABASE_URL: `file:${location.databasePath.replaceAll("\\", "/")}`,
      TUNARRTUBE_YTDLP_PATH: tools.ytdlp,
      TUNARRTUBE_FFMPEG_PATH: tools.ffmpeg,
      TUNARRTUBE_FFPROBE_PATH: tools.ffprobe,
      TUNARRTUBE_PUPPETEER_EXECUTABLE_PATH: tools.chromium
    });
    expect(env.PATH).toBe(["/release/runtime", "/release/tools", "/usr/bin"].join(path.delimiter));
  });

  it("lets the library's env file set options, and the launcher's own environment override both", () => {
    const location = libraryLocation(tempDir(), "data");
    writeFileSync(location.envFile, "TUNARRTUBE_TUNARR_URL=http://tunarr.lan:8000\nTUNARRTUBE_FFMPEG_PATH=/opt/ffmpeg\nTUNARRTUBE_AUTH_PASSWORD=from-file\n");
    const env = serverEnvironment({ ...base, baseEnv: { TUNARRTUBE_AUTH_PASSWORD: "from-shell" }, location });
    expect(env.TUNARRTUBE_TUNARR_URL).toBe("http://tunarr.lan:8000");
    expect(env.TUNARRTUBE_FFMPEG_PATH).toBe("/opt/ffmpeg");
    expect(env.TUNARRTUBE_AUTH_PASSWORD).toBe("from-shell");
  });

  it("doesn't shadow an operator's pre-rename YTARR_ tool path with the bundled one", () => {
    const location = libraryLocation(tempDir(), "data");
    const env = serverEnvironment({ ...base, baseEnv: { YTARR_YTDLP_PATH: "/custom/yt-dlp" }, location });
    expect(env.TUNARRTUBE_YTDLP_PATH).toBeUndefined();
  });

  it("extends Windows' Path in place rather than adding a second PATH key", () => {
    const location = libraryLocation(tempDir(), "data");
    const env = serverEnvironment({ ...base, baseEnv: { Path: "C:\\Windows" }, location });
    expect(env.PATH).toBeUndefined();
    expect(env.Path?.endsWith("C:\\Windows")).toBe(true);
  });
});

describe("isInside", () => {
  it("tells a folder inside the release apart from a sibling with a similar name", () => {
    expect(isInside("/release", "/release/library")).toBe(true);
    expect(isInside("/release", "/release")).toBe(true);
    expect(isInside("/release", "/release-library")).toBe(false);
    expect(isInside("/release", "/elsewhere")).toBe(false);
  });
});

describe("configuredDatabaseUrl", () => {
  it("prefers DATABASE_URL, then the data directory's tunarrtube.db, then the project default", () => {
    expect(configuredDatabaseUrl({ DATABASE_URL: "file:/x.db", TUNARRTUBE_DATA_DIR: "/data" })).toBe("file:/x.db");
    expect(configuredDatabaseUrl({ TUNARRTUBE_DATA_DIR: "/data" })).toBe(`file:${path.resolve("/data", "tunarrtube.db").replaceAll("\\", "/")}`);
    expect(configuredDatabaseUrl({})).toBe("file:./tunarrtube.db");
  });
});
