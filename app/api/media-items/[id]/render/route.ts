import { ok, toErrorResponse } from "@/lib/api";
import { enqueueChannelJob } from "@/lib/channels/service";
import { renderMediaItemSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const { templateId } = renderMediaItemSchema.parse(await request.json());
    const job = await enqueueChannelJob("render", { mediaItemId: id }, { templateId });
    return ok({ queued: true, jobId: job.id });
  } catch (error) {
    return toErrorResponse(error);
  }
}
