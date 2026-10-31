// Builds the portable release for one platform from an existing `npm run build`:
//
//   npm run build && node scripts/package-release.mjs [--target <target>] [--skip-tools] [--no-archive]
//
// Targets: linux-x64, linux-arm64, macos-arm64, macos-x64, windows-x64. The default is the current machine,
// and only the current machine's target can be built: the bundled Node.js (this script's own process.execPath)
// and native modules (better-sqlite3, Prisma's schema engine) come from this machine's install.
// .github/workflows/release-binaries.yml runs it once per target on a native runner.
//
// Output: dist/TunarrTube-<version>-<target>/ and its .tar.gz (.zip on Windows) plus a .sha256 file. The
// folder holds the launcher (packaging/launcher/), the Next.js standalone server, a Prisma CLI for
// `migrate deploy`, Node.js, and the tools TunarrTube runs -- yt-dlp, FFmpeg/ffprobe and Chrome Headless
// Shell -- each downloaded from its official release and checked against its published SHA-256.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const root = process.cwd();
const { values: args } = parseArgs({
  options: { target: { type: "string" }, "skip-tools": { type: "boolean" }, "no-archive": { type: "boolean" }, out: { type: "string", default: "dist" } }
});

const HOST_TARGETS = { "linux-x64": "linux-x64", "linux-arm64": "linux-arm64", "darwin-arm64": "macos-arm64", "darwin-x64": "macos-x64", "win32-x64": "windows-x64" };
const hostTarget = HOST_TARGETS[`${process.platform}-${process.arch}`];
const target = args.target ?? hostTarget;
if (!hostTarget) fail(`No portable release for ${process.platform}-${process.arch}.`);
if (target !== hostTarget) fail(`--target ${target} can only be built on a ${target} machine (this is ${hostTarget}).`);

const windows = target.startsWith("windows");
const exe = windows ? ".exe" : "";
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const name = `TunarrTube-${version}-${target}`;
const outDir = path.resolve(root, args.out);
const stage = path.join(outDir, name);
const cacheDir = path.join(outDir, ".download-cache");
const app = path.join(stage, "app");
const tools = path.join(stage, "tools");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function step(message) {
  console.log(`\n==> ${message}`);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const githubHeaders = { "User-Agent": "tunarrtube-release", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };

async function fetchText(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  return response.text();
}

// Downloads into the cache once, verifying it against `expectedSha256` every time it's used.
async function download(url, fileName, expectedSha256) {
  mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, fileName);
  if (!existsSync(file) || sha256(file) !== expectedSha256) {
    console.log(`Downloading ${url}`);
    const response = await fetch(url, { headers: { "User-Agent": "tunarrtube-release" } });
    if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  const actual = sha256(file);
  if (actual !== expectedSha256) throw new Error(`${fileName}: SHA-256 ${actual} doesn't match the published ${expectedSha256}.`);
  return file;
}

function checksumFor(sums, fileName) {
  const line = sums.split("\n").find((entry) => entry.trim().split(/\s+/).pop()?.replace(/^\*/, "") === fileName);
  if (!line) throw new Error(`No published checksum for ${fileName}.`);
  return line.trim().split(/\s+/)[0].toLowerCase();
}

function extract(archive, destination) {
  mkdirSync(destination, { recursive: true });
  // bsdtar (macOS, Windows' tar.exe) reads zip as well; GNU tar on Linux only ever gets .tar.xz here.
  execFileSync("tar", ["-xf", archive, "-C", destination], { stdio: "inherit" });
}

function findFile(directory, fileName) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, fileName);
      if (found) return found;
    } else if (entry.name === fileName) return full;
  }
  return null;
}

// --- yt-dlp: the official standalone build for each platform (self-updates from Settings -> Update) ---
const YTDLP_ASSETS = { "linux-x64": "yt-dlp_linux", "linux-arm64": "yt-dlp_linux_aarch64", "macos-arm64": "yt-dlp_macos", "macos-x64": "yt-dlp_macos", "windows-x64": "yt-dlp.exe" };

async function bundleYtDlp(notices) {
  const release = JSON.parse(await fetchText("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest", githubHeaders));
  const asset = YTDLP_ASSETS[target];
  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${release.tag_name}`;
  const sums = await fetchText(`${base}/SHA2-256SUMS`);
  const file = await download(`${base}/${asset}`, `${release.tag_name}-${asset}`, checksumFor(sums, asset));
  copyFileSync(file, path.join(tools, `yt-dlp${exe}`));
  chmodSync(path.join(tools, `yt-dlp${exe}`), 0o755);
  notices.push(`yt-dlp ${release.tag_name} -- Unlicense -- https://github.com/yt-dlp/yt-dlp`);
  return `yt-dlp${exe}`;
}

// --- FFmpeg/ffprobe: BtbN's static GPL builds (Linux, Windows) of the newest release branch; martin-riedl.de's
// signed static builds on macOS, which BtbN doesn't build for ---
const BTBN_TARGETS = { "linux-x64": "linux64", "linux-arm64": "linuxarm64", "windows-x64": "win64" };

async function bundleFfmpeg(notices) {
  const licenses = path.join(tools, "licenses");
  mkdirSync(licenses, { recursive: true });
  if (target.startsWith("macos")) {
    const arch = target === "macos-arm64" ? "arm64" : "amd64";
    let release;
    for (const binary of ["ffmpeg", "ffprobe"]) {
      // The "latest" URL redirects to a versioned one, which has the .sha256 file next to it.
      const redirect = await fetch(`https://ffmpeg.martin-riedl.de/redirect/latest/macos/${arch}/release/${binary}.zip`, { redirect: "manual" });
      const location = redirect.headers.get("location");
      if (!location) throw new Error(`martin-riedl.de: no download for macOS ${arch} ${binary}.`);
      const url = new URL(location, "https://ffmpeg.martin-riedl.de").toString();
      release = url.split("/").at(-2);
      const expected = (await fetchText(`${url}.sha256`)).trim().split(/\s+/)[0];
      const archive = await download(url, `${release}-${arch}-${binary}.zip`, expected);
      const scratch = path.join(cacheDir, `${release}-${arch}-${binary}`);
      rmSync(scratch, { recursive: true, force: true });
      extract(archive, scratch);
      copyFileSync(findFile(scratch, binary), path.join(tools, binary));
      chmodSync(path.join(tools, binary), 0o755);
    }
    notices.push(`FFmpeg ${release} (static build by Martin Riedl, https://ffmpeg.martin-riedl.de) -- GPL -- source: https://ffmpeg.org/download.html`);
  } else {
    const release = JSON.parse(await fetchText("https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest", githubHeaders));
    const pattern = new RegExp(`^ffmpeg-n(\\d+)\\.(\\d+)-latest-${BTBN_TARGETS[target]}-gpl-\\d+\\.\\d+\\.(zip|tar\\.xz)$`);
    const asset = release.assets
      .map((candidate) => ({ candidate, match: candidate.name.match(pattern) }))
      .filter(({ match }) => match)
      .sort((a, b) => Number(b.match[1]) - Number(a.match[1]) || Number(b.match[2]) - Number(a.match[2]))[0]?.candidate;
    if (!asset) throw new Error(`BtbN/FFmpeg-Builds: no GPL release build for ${target}.`);
    const sums = await fetchText(release.assets.find((candidate) => candidate.name === "checksums.sha256").browser_download_url);
    const archive = await download(asset.browser_download_url, asset.name, checksumFor(sums, asset.name));
    const scratch = path.join(cacheDir, asset.name.replace(/\.(zip|tar\.xz)$/, ""));
    rmSync(scratch, { recursive: true, force: true });
    extract(archive, scratch);
    for (const binary of ["ffmpeg", "ffprobe"]) {
      copyFileSync(findFile(scratch, `${binary}${exe}`), path.join(tools, `${binary}${exe}`));
      chmodSync(path.join(tools, `${binary}${exe}`), 0o755);
    }
    const license = findFile(scratch, "LICENSE.txt");
    if (license) copyFileSync(license, path.join(licenses, "FFmpeg-LICENSE.txt"));
    notices.push(`FFmpeg ${asset.name} (static build by BtbN, https://github.com/BtbN/FFmpeg-Builds) -- GPL -- source: https://github.com/BtbN/FFmpeg-Builds and https://ffmpeg.org/download.html`);
  }
  return { ffmpeg: `ffmpeg${exe}`, ffprobe: `ffprobe${exe}` };
}

// --- Chrome Headless Shell for Channels overlays: the build this Puppeteer version is pinned to. Chrome for
// Testing has no Linux arm64 build; that release uses a system Chromium instead (see the launcher). ---
const PUPPETEER_PLATFORMS = { "linux-x64": "linux", "macos-arm64": "mac_arm", "macos-x64": "mac", "windows-x64": "win64" };

function bundleChromium(notices) {
  if (!PUPPETEER_PLATFORMS[target]) {
    console.log(`No Chrome Headless Shell build for ${target}; the release will use a system Chromium for overlays.`);
    return null;
  }
  const revisions = readFileSync(path.join(root, "node_modules", "puppeteer-core", "lib", "puppeteer", "revisions.js"), "utf8");
  const buildId = revisions.match(/'chrome-headless-shell':\s*'([^']+)'/)?.[1];
  if (!buildId) throw new Error("Couldn't read Puppeteer's pinned chrome-headless-shell version.");
  const cache = path.join(tools, "chromium");
  const result = spawnSync(process.execPath, [path.join(root, "node_modules", "puppeteer", "lib", "puppeteer", "node", "cli.js"), "browsers", "install", `chrome-headless-shell@${buildId}`, "--platform", PUPPETEER_PLATFORMS[target], "--format", "{{path}}"], {
    env: { ...process.env, PUPPETEER_CACHE_DIR: cache },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  });
  if (result.status !== 0) throw new Error("Installing Chrome Headless Shell failed.");
  const executable = result.stdout.trim().split("\n").pop().trim();
  notices.push(`Chrome Headless Shell ${buildId} (Chrome for Testing) -- BSD-3-Clause and others -- https://developer.chrome.com/blog/chrome-headless-shell`);
  return path.relative(tools, executable).replaceAll("\\", "/");
}

// --- Prisma CLI, only for `prisma migrate deploy` at startup; installed on its own so its dependencies never
// mix with the traced standalone node_modules ---
function bundlePrismaCli() {
  const prismaVersion = pkg.devDependencies.prisma;
  const directory = path.join(app, "prisma-cli");
  mkdirSync(directory, { recursive: true });
  // npm only runs the install scripts allow-listed here; @prisma/engines' downloads this platform's schema engine.
  const allowScripts = Object.fromEntries(Object.entries(pkg.allowScripts ?? {}).filter(([key]) => key.startsWith("prisma@") || key.startsWith("@prisma/")));
  writeFileSync(path.join(directory, "package.json"), `${JSON.stringify({ name: "tunarrtube-prisma-cli", private: true, dependencies: { prisma: prismaVersion, "@prisma/config": prismaVersion }, allowScripts }, null, 2)}\n`);
  const npm = windows ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], { cwd: directory, stdio: "inherit", shell: windows });
  if (result.status !== 0) throw new Error("Installing the Prisma CLI failed.");
  copyFileSync(path.join(root, "packaging", "prisma.config.mjs"), path.join(directory, "prisma.config.mjs"));
}

// The official nodejs.org build of exactly this Node.js version: same ABI as the native modules `npm ci`
// just installed, but self-contained -- process.execPath itself may be a distro or Homebrew build that
// links shared libraries from that machine.
const NODE_DIST = { "linux-x64": "linux-x64.tar.xz", "linux-arm64": "linux-arm64.tar.xz", "macos-arm64": "darwin-arm64.tar.gz", "macos-x64": "darwin-x64.tar.gz", "windows-x64": "win-x64.zip" };

async function bundleNode(notices) {
  const nodeVersion = process.version;
  const fileName = `node-${nodeVersion}-${NODE_DIST[target]}`;
  const base = `https://nodejs.org/dist/${nodeVersion}`;
  const archiveFile = await download(`${base}/${fileName}`, fileName, checksumFor(await fetchText(`${base}/SHASUMS256.txt`), fileName));
  const scratch = path.join(cacheDir, fileName.replace(/\.(zip|tar\.[gx]z)$/, ""));
  rmSync(scratch, { recursive: true, force: true });
  extract(archiveFile, scratch);
  const runtime = path.join(stage, "runtime");
  mkdirSync(runtime, { recursive: true });
  const extracted = path.join(scratch, path.basename(scratch));
  copyFileSync(path.join(extracted, windows ? "node.exe" : path.join("bin", "node")), path.join(runtime, `node${exe}`));
  chmodSync(path.join(runtime, `node${exe}`), 0o755);
  copyFileSync(path.join(extracted, "LICENSE"), path.join(runtime, "LICENSE"));
  notices.push(`Node.js ${nodeVersion} -- MIT and others (runtime/LICENSE) -- https://nodejs.org`);
}

function bundleApp() {
  const standalone = path.join(root, ".next", "standalone");
  if (!existsSync(path.join(standalone, "server.js"))) fail("No .next/standalone build found. Run `npm run build` first.");
  cpSync(standalone, app, { recursive: true });
  cpSync(path.join(root, ".next", "static"), path.join(app, ".next", "static"), { recursive: true });
  if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(app, "public"), { recursive: true });
  // Next copies .env files into the standalone output; a developer's secrets must never ship.
  for (const entry of readdirSync(app)) if (entry.startsWith(".env")) rmSync(path.join(app, entry));
  mkdirSync(path.join(app, "prisma"), { recursive: true });
  copyFileSync(path.join(root, "prisma", "schema.prisma"), path.join(app, "prisma", "schema.prisma"));
  cpSync(path.join(root, "prisma", "migrations"), path.join(app, "prisma", "migrations"), { recursive: true });
  mkdirSync(path.join(app, "scripts"), { recursive: true });
  copyFileSync(path.join(root, "scripts", "migrate-legacy-database.mjs"), path.join(app, "scripts", "migrate-legacy-database.mjs"));
  const leaked = findLeaks(app);
  if (leaked.length) fail(`Refusing to package local data found in the build output:\n${leaked.join("\n")}`);
}

// A database, media, or credentials that tracing picked up from this checkout.
function findLeaks(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      if (entry.name === "storage" && directory === app) found.push(full);
      else findLeaks(full, found);
    } else if (/\.db(-wal|-shm|-journal)?$/.test(entry.name) || /cookies.*\.txt$/i.test(entry.name)) found.push(full);
  }
  return found;
}

function bundleLauncher() {
  cpSync(path.join(root, "packaging", "launcher"), path.join(stage, "launcher"), { recursive: true });
  const entries = windows ? ["TunarrTube.cmd"] : target.startsWith("macos") ? ["TunarrTube.command"] : ["tunarrtube"];
  for (const entry of entries) {
    copyFileSync(path.join(root, "packaging", "entry", entry), path.join(stage, entry));
    chmodSync(path.join(stage, entry), 0o755);
  }
  const readme = readFileSync(path.join(root, "packaging", "README.txt"), "utf8").replaceAll("{{version}}", version).replaceAll("{{target}}", target);
  writeFileSync(path.join(stage, "README.txt"), windows ? readme.replace(/\r?\n/g, "\r\n") : readme);
  copyFileSync(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));
}

function archive() {
  const file = windows ? `${name}.zip` : `${name}.tar.gz`;
  const output = path.join(outDir, file);
  rmSync(output, { force: true });
  // bsdtar picks the zip format from the .zip extension with -a; Windows ships bsdtar as tar.exe.
  execFileSync("tar", windows ? ["-a", "-cf", output, name] : ["-czf", output, name], { cwd: outDir, stdio: "inherit" });
  writeFileSync(`${output}.sha256`, `${sha256(output)}  ${file}\n`);
  console.log(`\n${output} (${(statSync(output).size / 1024 / 1024).toFixed(0)} MB)`);
}

step(`Packaging ${name}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(tools, { recursive: true });
const notices = [`TunarrTube ${version} -- MIT (LICENSE)`];
step("App");
bundleApp();
step("Prisma CLI");
bundlePrismaCli();
step("Node.js");
await bundleNode(notices);
const manifest = { target, version };
if (!args["skip-tools"]) {
  step("yt-dlp");
  manifest.ytdlp = await bundleYtDlp(notices);
  step("FFmpeg");
  Object.assign(manifest, await bundleFfmpeg(notices));
  step("Chrome Headless Shell");
  manifest.chromium = bundleChromium(notices);
}
writeFileSync(path.join(tools, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
step("Launcher");
bundleLauncher();
writeFileSync(path.join(stage, "THIRD-PARTY-NOTICES.txt"), `TunarrTube ${version} (${target}) bundles the following software, each under its own license.\nLicense texts are in runtime/LICENSE, tools/licenses/ and the projects linked below.\n\n${notices.map((notice) => `- ${notice}`).join("\n")}\n`);
if (!args["no-archive"]) {
  step("Archive");
  archive();
}
