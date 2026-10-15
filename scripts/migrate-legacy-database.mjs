import { existsSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The SQLite file was named "ytarr.db" before the project was renamed to TunarrTube. When the configured
// database is the new default name and doesn't exist yet, but a legacy file sits in the same directory,
// move it (and any WAL/SHM/journal files) across so the upgrade keeps its data. Must run before
// `prisma migrate deploy` or scripts/prepare-dev.mjs create an empty database under the new name -- see
// prepare-dev.mjs and the Dockerfile's CMD. An explicitly configured DATABASE_URL that still names
// ytarr.db is left alone: that's the operator's choice, and it keeps working as-is.
export const DATABASE_FILENAME = "tunarrtube.db";
const LEGACY_DATABASE_FILENAME = "ytarr.db";
const SQLITE_SUFFIXES = ["", "-wal", "-shm", "-journal"];

// Same convention as lib/db/client.ts and prisma.config.ts: relative file: URLs resolve against prisma/.
export function resolveDatabasePath(url, projectRoot = process.cwd()) {
  if (!url.startsWith("file:")) return null;
  const configured = url.slice(5);
  return path.isAbsolute(configured) ? configured : path.resolve(projectRoot, "prisma", configured);
}

export function migrateLegacyDatabase(databasePath) {
  if (!databasePath || path.basename(databasePath) !== DATABASE_FILENAME) return false;
  // A zero-byte file is what prepare-dev.mjs's placeholder looks like before any migration ran -- treat
  // it as absent rather than letting it hide real data in the legacy file.
  if (existsSync(databasePath) && statSync(databasePath).size > 0) return false;
  const legacyPath = path.join(path.dirname(databasePath), LEGACY_DATABASE_FILENAME);
  if (!existsSync(legacyPath)) return false;
  for (const suffix of SQLITE_SUFFIXES) {
    if (existsSync(`${legacyPath}${suffix}`)) renameSync(`${legacyPath}${suffix}`, `${databasePath}${suffix}`);
  }
  console.log(`Renamed legacy database ${legacyPath} to ${databasePath}.`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  migrateLegacyDatabase(resolveDatabasePath(process.env.DATABASE_URL || `file:./${DATABASE_FILENAME}`));
}
