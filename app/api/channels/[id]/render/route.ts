import { ok, toErrorResponse } from "@/lib/api";
import { enqueueChannelRenders } from "@/lib/channels/service";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    return ok(await enqueueChannelRenders((await params).id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
