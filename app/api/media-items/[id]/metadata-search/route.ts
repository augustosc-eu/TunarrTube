import { AppError, ok, toErrorResponse } from "@/lib/api";
import { searchMetadata } from "@/lib/metadata-lookup/service";
import { db } from "@/lib/db/client";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const mediaItem = await db.mediaItem.findUnique({ where: { id } });
    if (!mediaItem) throw new AppError("MEDIA_ITEM_NOT_FOUND", "Media item not found.", 404);
    const search = new URL(request.url).searchParams;
    const title = search.get("title")?.trim() || mediaItem.title;
    const artist = search.get("artist")?.trim() || mediaItem.artist || undefined;
    return ok(await searchMetadata({ title, artist }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
