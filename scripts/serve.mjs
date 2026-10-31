// `npm run serve`: back up the database, rebuild only when the source changed since the last build, then
// `npm start`. A full `next build` takes minutes, but most restarts run the same code as last time.
//
//   npm run serve              # 127.0.0.1 (same as npm start)
//   npm run serve -- --lan     # all interfaces (same as npm run start:lan)
//   npm run serve -- --rebuild # build even if nothing changed
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { configuredDatabaseUrl, resolveDatabasePath } from "./migrate-legacy-database.mjs";

const projectRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const BACKUPS_TO_KEEP = 10;
// Lives inside .next so deleting the build output also invalidates it.
const fingerprintPath = path.join(projectRoot, ".next", "serve-fingerprint");
// Files that can't change what `next build` produces.
const IGNORED_FOR_BUILD = [/^tests\//, /^docs\//, /^\.github\//, /^\.vscode\//, /^\.claude\//, /\.md$/i];

if (existsSync(path.join(projectRoot, ".env")) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(path.join(projectRoot, ".env"));
}

function run(script) {
  const result = spawnSync(npm, ["run", script], { cwd: projectRoot, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function backupDatabase() {
  const databasePath = resolveDatabasePath(configuredDatabaseUrl(), projectRoot);
  if (!databasePath || !existsSync(databasePath) || statSync(databasePath).size === 0) return;
  const backupDir = path.join(path.dirname(databasePath), "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const base = path.basename(databasePath, ".db");
  const target = path.join(backupDir, `${base}-${stamp}.db`);
  // SQLite's online backup API, not a file copy: it includes pages still in the WAL file.
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  return db.backup(target).finally(() => db.close()).then(() => {
    const backups = readdirSync(backupDir).filter((name) => name.startsWith(`${base}-`) && name.endsWith(".db")).sort();
    for (const old of backups.slice(0, -BACKUPS_TO_KEEP)) rmSync(path.join(backupDir, old));
    console.log(`Backed up database to ${path.relative(projectRoot, target)}.`);
  });
}

// Hash of every tracked or untracked-but-not-ignored file that can affect the build, or null without git.
function sourceFingerprint() {
  const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: projectRoot, encoding: "utf8" });
  if (listed.status !== 0) return null;
  const hash = createHash("sha256");
  const files = [...new Set(listed.stdout.split("\0").filter(Boolean))].sort();
  for (const file of files) {
    if (IGNORED_FOR_BUILD.some((pattern) => pattern.test(file))) continue;
    const absolute = path.join(projectRoot, file);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue; // deleted but not yet staged
    hash.update(file).update("\0").update(readFileSync(absolute)).update("\0");
  }
  return hash.digest("hex");
}

function buildIfStale() {
  const fingerprint = sourceFingerprint();
  const built = existsSync(path.join(projectRoot, ".next", "BUILD_ID"));
  const previous = existsSync(fingerprintPath) ? readFileSync(fingerprintPath, "utf8").trim() : null;
  if (!args.has("--rebuild") && built && fingerprint && fingerprint === previous) {
    console.log("Source unchanged since the last build; skipping `next build`.");
    return;
  }
  console.log(built ? "Source changed since the last build; rebuilding." : "No build found; building.");
  rmSync(fingerprintPath, { force: true });
  run("build");
  if (fingerprint) writeFileSync(fingerprintPath, `${fingerprint}\n`);
}

await backupDatabase();
buildIfStale();
run(args.has("--lan") ? "start:lan" : "start");
