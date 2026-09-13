import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { writeLog } from "@/lib/logging/service";
import type { MetadataCandidate } from "@/lib/metadata-lookup/types";

export async function getMediaItem(id: string) {
  const item = await db.mediaItem.findUnique({ where: { id }, include: { renders: true, sourceVideo: true } });
  if (!item) throw new AppError("MEDIA_ITEM_NOT_FOUND", "Media item not found.", 404);
  return item;
}

export async function updateMediaItemMetadata(id: string, input: {
  title?: string;
  artist?: string | null;
  album?: string | null;
  year?: number | null;
  genre?: string | null;
  releaseDate?: string | null;
  customFieldsJson?: string | null;
}) {
  const item = await db.mediaItem.findUnique({ where: { id } });
  if (!item) throw new AppError("MEDIA_ITEM_NOT_FOUND", "Media item not found.", 404);
  const updated = await db.mediaItem.update({
    where: { id },
    data: {
      ...input,
      releaseDate: input.releaseDate === undefined ? undefined : input.releaseDate ? new Date(input.releaseDate) : null,
      metadataStatus: "manual",
      metadataLookupProvider: null,
      metadataLookupId: null,
      metadataLookupJson: null
    }
  });
  await writeLog({ category: "metadata", mediaItemId: id, message: `Manually edited metadata for "${updated.title}".` });
  return updated;
}

export async function applyMetadataCandidate(id: string, candidate: MetadataCandidate) {
  const item = await db.mediaItem.findUnique({ where: { id } });
  if (!item) throw new AppError("MEDIA_ITEM_NOT_FOUND", "Media item not found.", 404);
  const updated = await db.mediaItem.update({
    where: { id },
    data: {
      title: candidate.title,
      artist: candidate.artist ?? null,
      album: candidate.album ?? null,
      year: candidate.year ?? null,
      releaseDate: candidate.releaseDate ? new Date(candidate.releaseDate) : null,
      sourceThumbnailUrl: candidate.artUrl ?? item.sourceThumbnailUrl,
      metadataStatus: "matched",
      metadataLookupProvider: candidate.provider,
      metadataLookupId: candidate.externalId,
      metadataLookupJson: JSON.stringify(candidate)
    }
  });
  await writeLog({ category: "metadata", mediaItemId: id, message: `Applied ${candidate.provider} metadata: "${candidate.title}" by ${candidate.artist ?? "unknown artist"}.` });
  return updated;
}
