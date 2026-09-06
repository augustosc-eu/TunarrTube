import { db } from "@/lib/db/client";
import { musicBrainzProvider } from "@/lib/metadata-lookup/musicbrainz";
import { itunesProvider } from "@/lib/metadata-lookup/itunes";
import { applyMetadataCandidate } from "@/lib/media-items/service";
import type { MetadataCandidate } from "@/lib/metadata-lookup/types";

export async function searchMetadata(query: { title: string; artist?: string }, signal?: AbortSignal): Promise<MetadataCandidate[]> {
  const [musicbrainz, itunes] = await Promise.allSettled([
    musicBrainzProvider.search(query, signal),
    itunesProvider.search(query, signal)
  ]);
  const results: MetadataCandidate[] = [];
  if (musicbrainz.status === "fulfilled") results.push(...musicbrainz.value);
  if (itunes.status === "fulfilled") results.push(...itunes.value);
  return results.sort((a, b) => b.score - a.score);
}

export async function applyMetadata(mediaItemId: string, candidate: MetadataCandidate) {
  return applyMetadataCandidate(mediaItemId, candidate);
}

export async function findMediaItemForLookup(mediaItemId: string) {
  return db.mediaItem.findUniqueOrThrow({ where: { id: mediaItemId } });
}
