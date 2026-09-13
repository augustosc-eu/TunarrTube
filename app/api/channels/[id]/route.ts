import { ok, serialize, toErrorResponse } from "@/lib/api";
import { deleteChannel, getChannel, updateChannel } from "@/lib/channels/service";
import { updateChannelSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return ok(serialize(await getChannel((await params).id)));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const input = updateChannelSchema.parse(await request.json());
    return ok(serialize(await updateChannel((await params).id, input)));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    await deleteChannel((await params).id);
    return ok({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
