import { db } from "@/lib/db/client";
import { musicBrainzProvider } from "@/lib/metadata-lookup/musicbrainz";
import { itunesProvider } from "@/lib/metadata-lookup/itunes";
import { applyMetadataCandidate } from "@/lib/media-items/service";
import { getSettings } from "@/lib/settings/service";
import { writeLog } from "@/lib/logging/service";
import type { MetadataCandidate } from "@/lib/metadata-lookup/types";

// providerFilter lets a caller skip a provider the user has disabled in Settings (autoApplyMetadata
// below) without touching the manual "Search" flow in the media item editor, which always tries both
// regardless of the auto-apply settings -- a manual search is a one-off, explicit user action, not the
// background lookup those settings are meant to throttle.
export async function searchMetadata(query: { title: string; artist?: string }, signal?: AbortSignal, providerFilter?: { musicbrainz: boolean; itunes: boolean }): Promise<MetadataCandidate[]> {
  const useMusicbrainz = providerFilter?.musicbrainz ?? true;
  const useItunes = providerFilter?.itunes ?? true;
  const [musicbrainz, itunes] = await Promise.allSettled([
    useMusicbrainz ? musicBrainzProvider.search(query, signal) : Promise.resolve<MetadataCandidate[]>([]),
    useItunes ? itunesProvider.search(query, signal) : Promise.resolve<MetadataCandidate[]>([])
  ]);
  const results: MetadataCandidate[] = [];
  if (musicbrainz.status === "fulfilled") results.push(...musicbrainz.value);
  else if (useMusicbrainz) await writeLog({ level: "warn", category: "metadata", message: `MusicBrainz lookup for "${query.title}" failed: ${musicbrainz.reason instanceof Error ? musicbrainz.reason.message : String(musicbrainz.reason)}` }).catch(() => undefined);
  if (itunes.status === "fulfilled") results.push(...itunes.value);
  else if (useItunes) await writeLog({ level: "warn", category: "metadata", message: `iTunes lookup for "${query.title}" failed: ${itunes.reason instanceof Error ? itunes.reason.message : String(itunes.reason)}` }).catch(() => undefined);
  return results.sort((a, b) => b.score - a.score);
}

export async function applyMetadata(mediaItemId: string, candidate: MetadataCandidate) {
  return applyMetadataCandidate(mediaItemId, candidate);
}

export async function findMediaItemForLookup(mediaItemId: string) {
  return db.mediaItem.findUniqueOrThrow({ where: { id: mediaItemId } });
}

// The "metadata_lookup" job (lib/jobs/runner.ts) queued by attachExistingVideo/scanLocalFolder
// (lib/channels/service.ts, lib/ingest/local-scan.ts) right after a new MediaItem is created with no
// artist. Mirrors the manual "Search" + "Apply" the media item editor already does, just automatic and
// gated on a confidence threshold so a wrong guess doesn't silently overwrite a title with a bad match.
export async function autoApplyMetadata(mediaItemId: string, signal?: AbortSignal) {
  const item = await db.mediaItem.findUnique({ where: { id: mediaItemId } });
  if (!item) return; // Deleted before this queued job ran.
  // Nothing to fill in: already has an artist, or the user already resolved (or explicitly edited)
  // this item's metadata themselves -- never second-guess either.
  if (item.artist || item.metadataStatus === "manual" || item.metadataStatus === "matched") return;

  const settings = await getSettings();
  const candidates = await searchMetadata({ title: item.title }, signal, { musicbrainz: settings.metadataMusicbrainzEnabled, itunes: settings.metadataItunesEnabled });
  const best = candidates.find((candidate) => candidate.artist);
  if (best && best.score >= settings.metadataAutoApplyThreshold) {
    await applyMetadataCandidate(mediaItemId, best);
    return;
  }
  await writeLog({
    category: "metadata", mediaItemId,
    message: best
      ? `No confident automatic metadata match for "${item.title}" (best candidate "${best.title}" by ${best.artist} scored ${best.score}, below the ${settings.metadataAutoApplyThreshold} auto-apply threshold).`
      : `No automatic metadata match found for "${item.title}".`
  });
}
