import { ok, serialize, toErrorResponse } from "@/lib/api";
import { createChannelFromBrief } from "@/lib/channels/service";
import { createChannelFromBriefSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const input = createChannelFromBriefSchema.parse(await request.json());
    const result = await createChannelFromBrief(input);
    return ok(serialize({ channelId: result.channel.id, jobId: result.jobId }), { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
