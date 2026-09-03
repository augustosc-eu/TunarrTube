import { access, rm } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { getSettings } from "@/lib/settings/service";
import { writeLog } from "@/lib/logging/service";

async function exists(file: string | null) {
  if (!file) return false;
  try { await access(file); return true; } catch { return false; }
}

export async function protectedVideoIds() {
  const rows = await db.sourceVideo.findMany({ where: { retentionOrigin: "tunarr", source: { tunarrChannelId: { not: null } } }, select: { videoId: true } });
  return new Set(rows.map((row) => row.videoId));
}

async function removeAsset(id: string, force = false) {
  const asset = await db.cacheAsset.findUnique({ where: { id }, include: { video: true } });
  if (!asset) throw new AppError("CACHE_ASSET_NOT_FOUND", "Cache asset not found.", 404);
  const protectedIds = await protectedVideoIds();
  if (!force && (asset.pinned || asset.activeReaders > 0 || protectedIds.has(asset.videoId))) throw new AppError("CACHE_ASSET_PROTECTED", "This cache asset is pinned, playing, or required by Tunarr.", 409);
  if (asset.localPath) await rm(asset.localPath, { force: true });
  await db.cacheAsset.update({ where: { id }, data: { status: "not_cached", localPath: null, fileSize: null, cachedAt: null, lastAccessedAt: null, error: null } });
  await writeLog({ category: "cache", videoId: asset.videoId, message: `Evicted ${asset.video.youtubeId}.` });
  return asset.fileSize ?? 0n;
}

export async function enforceCachePolicy(clear = false) {
  const settings = await getSettings();
  const protectedIds = await protectedVideoIds();
  const assets = await db.cacheAsset.findMany({ where: { status: "complete" }, orderBy: [{ lastAccessedAt: "asc" }, { cachedAt: "asc" }] });
  const limit = BigInt(settings.cacheMaxMegabytes) * 1024n * 1024n;
  let total = assets.reduce((sum, item) => sum + (item.fileSize ?? 0n), 0n);
  const cutoff = Date.now() - settings.cacheMaxAgeDays * 86_400_000;
  let evicted = 0;
  for (const asset of assets) {
    if (asset.pinned || asset.activeReaders > 0 || protectedIds.has(asset.videoId)) continue;
    if (!clear && asset.cachedAt && Date.now() - asset.cachedAt.getTime() < 5 * 60_000) continue;
    const expired = (asset.lastAccessedAt ?? asset.cachedAt ?? asset.createdAt).getTime() < cutoff;
    if (!clear && !expired && total <= limit) continue;
    total -= await removeAsset(asset.id);
    evicted += 1;
  }
  return { evicted, bytesRemaining: total, limitBytes: limit, overLimit: total > limit };
}

export async function cacheDashboard() {
  const [settings, assets, jobs, protectedIds] = await Promise.all([
    getSettings(),
    db.cacheAsset.findMany({ where: { status: { not: "not_cached" } }, include: { video: { include: { sources: { include: { source: { select: { id: true, name: true, tunarrChannelId: true } } } } } } }, orderBy: { lastAccessedAt: "desc" } }),
    db.job.count({ where: { type: "cache", status: { in: ["queued", "running"] } } }),
    protectedVideoIds()
  ]);
  const complete = assets.filter((item) => item.status === "complete");
  const sum = (items: typeof complete) => items.reduce((total, item) => total + (item.fileSize ?? 0n), 0n);
  return {
    maxBytes: BigInt(settings.cacheMaxMegabytes) * 1024n * 1024n,
    maxAgeDays: settings.cacheMaxAgeDays,
    totalBytes: sum(complete),
    protectedBytes: sum(complete.filter((item) => protectedIds.has(item.videoId))),
    pinnedBytes: sum(complete.filter((item) => item.pinned)),
    evictableBytes: sum(complete.filter((item) => !item.pinned && item.activeReaders === 0 && !protectedIds.has(item.videoId))),
    activeJobs: jobs,
    assets: assets.map((asset) => ({
      id: asset.id, videoId: asset.videoId, fileSize: asset.fileSize, status: asset.status, pinned: asset.pinned,
      lastAccessedAt: asset.lastAccessedAt, cachedAt: asset.cachedAt, protected: protectedIds.has(asset.videoId),
      video: { title: asset.video.title, youtubeId: asset.video.youtubeId, sources: asset.video.sources.map((membership) => ({ source: { id: membership.source.id, name: membership.source.name } })) }
    }))
  };
}

export async function mutateCacheAsset(id: string, action: "pin" | "unpin" | "evict") {
  if (action === "evict") { await removeAsset(id); return { id, evicted: true }; }
  return db.cacheAsset.update({ where: { id }, data: { pinned: action === "pin" } });
}

export async function reconcileCacheFiles() {
  const assets = await db.cacheAsset.findMany({ where: { status: "complete" } });
  let missing = 0;
  for (const asset of assets) if (!(await exists(asset.localPath))) {
    await db.cacheAsset.update({ where: { id: asset.id }, data: { status: "not_cached", localPath: null, fileSize: null, cachedAt: null, lastAccessedAt: null } });
    missing += 1;
  }
  return missing;
}
