import { ok, serialize, toErrorResponse } from "@/lib/api";
import { getMediaItem, updateMediaItemMetadata } from "@/lib/media-items/service";
import { updateMediaItemSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return ok(serialize(await getMediaItem((await params).id)));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const input = updateMediaItemSchema.parse(await request.json());
    return ok(serialize(await updateMediaItemMetadata((await params).id, input)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
