import { ok, toErrorResponse } from "@/lib/api";
import { reorderChannelItems } from "@/lib/channels/service";
import { reorderChannelItemsSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const { mediaItemIds } = reorderChannelItemsSchema.parse(await request.json());
    await reorderChannelItems(id, mediaItemIds);
    return ok({ reordered: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
