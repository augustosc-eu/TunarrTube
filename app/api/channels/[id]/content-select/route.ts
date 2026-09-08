import { ok, toErrorResponse } from "@/lib/api";
import { enqueueChannelJob } from "@/lib/channels/service";
import { selectChannelContentSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const input = selectChannelContentSchema.parse(await request.json());
    const job = await enqueueChannelJob("content_select", { channelId: id }, {
      sourceIds: input.sourceIds, instructions: input.instructions, targetCount: input.targetCount, providerOverride: input.aiProvider
    });
    return ok({ queued: true, jobId: job.id }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
