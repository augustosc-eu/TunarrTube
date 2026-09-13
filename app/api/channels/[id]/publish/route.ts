import { ok, toErrorResponse } from "@/lib/api";
import { enqueueChannelJob } from "@/lib/channels/service";
import { channelTunarrLinkStatus, unlinkChannelFromTunarr } from "@/lib/tunarr/channel-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return ok(await channelTunarrLinkStatus((await params).id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(_request: Request, { params }: Context) {
  try {
    const job = await enqueueChannelJob("channel_publish", { channelId: (await params).id });
    return ok({ queued: true, jobId: job.id });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    return ok(await unlinkChannelFromTunarr((await params).id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
