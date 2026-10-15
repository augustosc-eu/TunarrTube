import { access, rename, rm } from "node:fs/promises";
import path from "node:path";
import { CACHE_DIRECTORY_NAME } from "@/lib/constants";
import { db } from "@/lib/db/client";
import { writeLog } from "@/lib/logging/service";
import { getSettings } from "@/lib/settings/service";

// On-disk names used before the project was renamed to TunarrTube. Existing installs still have folders
// with these names inside their media directories (and CacheAsset rows pointing into them), so this module
// is the one place that knows them. The database file has its own pre-start counterpart in
// scripts/migrate-legacy-database.mjs, since it has to move before Prisma opens or migrates it.
export const LEGACY_CACHE_DIRECTORY_NAME = "._ytarr-cache";
export const LEGACY_TEMP_DIRECTORY_NAME = "._ytarr-tmp";

async function exists(target: string) {
  return access(target).then(() => true, () => false);
}

// "<root>/videos/<id>.mp4" -> "<root>", only when <root> is a legacy cache folder.
function legacyCacheRootOf(localPath: string) {
  const root = path.dirname(path.dirname(path.resolve(localPath)));
  return path.basename(root) === LEGACY_CACHE_DIRECTORY_NAME ? root : null;
}

// Renames every legacy cache folder (the current media base's, plus any an older media base left behind
// that CacheAsset rows still point into) to CACHE_DIRECTORY_NAME, rewrites those rows' localPath, and
// removes legacy per-download temp roots. Idempotent and cheap once nothing legacy remains. Runs from
// instrumentation.ts before the job worker starts, so no download or cache job is writing into these
// folders while they move.
export async function migrateLegacyStorageNames() {
  const settings = await getSettings();
  const legacyAssets = await db.cacheAsset.findMany({
    where: { localPath: { contains: LEGACY_CACHE_DIRECTORY_NAME } },
    select: { id: true, localPath: true }
  });
  const legacyRoots = new Set([path.join(path.resolve(settings.mediaBaseDirectory), LEGACY_CACHE_DIRECTORY_NAME)]);
  for (const asset of legacyAssets) {
    const root = asset.localPath ? legacyCacheRootOf(asset.localPath) : null;
    if (root) legacyRoots.add(root);
  }

  let movedFolders = 0;
  let rewrittenAssets = 0;
  const cacheVideoDirectories: string[] = [];
  for (const legacyRoot of legacyRoots) {
    const newRoot = path.join(path.dirname(legacyRoot), CACHE_DIRECTORY_NAME);
    if (await exists(legacyRoot)) {
      if (await exists(newRoot)) {
        await writeLog({ level: "warn", category: "maintenance", message: `Left ${legacyRoot} in place: ${newRoot} already exists. Move any files you still need by hand.` });
        continue;
      }
      await rename(legacyRoot, newRoot);
      movedFolders += 1;
    }
    if (!(await exists(newRoot))) continue;
    cacheVideoDirectories.push(path.join(newRoot, "videos"));
    // Rewritten whenever the files now live under the new name -- including after an earlier run that
    // renamed the folder but stopped before updating the rows.
    for (const asset of legacyAssets) {
      if (!asset.localPath || legacyCacheRootOf(asset.localPath) !== legacyRoot) continue;
      await db.cacheAsset.update({ where: { id: asset.id }, data: { localPath: path.join(newRoot, path.relative(legacyRoot, path.resolve(asset.localPath))) } });
      rewrittenAssets += 1;
    }
  }

  // Legacy temp roots sit next to each download target: a source's media directory, a subfolder its
  // naming scheme created (e.g. "Season 2026"), or the cache's videos folder. Each per-attempt folder
  // inside was already deleted when its download finished, so anything left is debris from an interrupted
  // run -- and no download is running yet at this point.
  const [sources, memberships] = await Promise.all([
    db.source.findMany({ select: { mediaDirectory: true } }),
    db.sourceVideo.findMany({ where: { localPath: { not: null } }, select: { localPath: true } })
  ]);
  const downloadDirectories = new Set([
    ...sources.map((source) => source.mediaDirectory),
    ...memberships.map((membership) => path.dirname(membership.localPath!)),
    ...cacheVideoDirectories
  ]);
  let removedTempRoots = 0;
  for (const directory of downloadDirectories) {
    if (!path.isAbsolute(directory)) continue;
    const legacyTemp = path.join(directory, LEGACY_TEMP_DIRECTORY_NAME);
    if (!(await exists(legacyTemp))) continue;
    await rm(legacyTemp, { recursive: true, force: true });
    removedTempRoots += 1;
  }
  if (movedFolders || rewrittenAssets || removedTempRoots) {
    await writeLog({
      category: "maintenance",
      message: `Renamed ${movedFolders} legacy cache folder${movedFolders === 1 ? "" : "s"} to ${CACHE_DIRECTORY_NAME}, updated ${rewrittenAssets} cache entr${rewrittenAssets === 1 ? "y" : "ies"}, and removed ${removedTempRoots} legacy temp folder${removedTempRoots === 1 ? "" : "s"}.`
    });
  }
  return { movedFolders, rewrittenAssets, removedTempRoots };
}
