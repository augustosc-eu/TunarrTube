import { AppError, ok, toErrorResponse } from "@/lib/api";
import { db } from "@/lib/db/client";
import { enqueueChannelJob } from "@/lib/channels/service";

type Context = { params: Promise<{ id: string }> };

// Queues a "render" job (channel's template x each media item) for every item that doesn't
// already have a complete render for that template. Rendering one media item that's shared by
// several channels is deliberately idempotent -- see the RenderedAsset unique constraint.
export async function POST(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const channel = await db.channel.findUnique({ where: { id }, include: { items: true } });
    if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Channel not found.", 404);

    const renders = await db.renderedAsset.findMany({
      where: { templateId: channel.templateId, mediaItemId: { in: channel.items.map((item) => item.mediaItemId) } }
    });
    const complete = new Set(renders.filter((render) => render.status === "complete").map((render) => render.mediaItemId));
    const pending = channel.items.filter((item) => !complete.has(item.mediaItemId));

    const jobs = [];
    for (const item of pending) {
      const mediaItem = await db.mediaItem.findUnique({ where: { id: item.mediaItemId }, include: { sourceVideo: true } });
      const ready = mediaItem?.originType === "local" ? Boolean(mediaItem.originLocalPath) : mediaItem?.sourceVideo?.downloadStatus === "complete";
      if (!ready) continue; // not downloaded/available yet -- skip silently, retry later
      jobs.push(await enqueueChannelJob("render", { mediaItemId: item.mediaItemId }, { templateId: channel.templateId }));
    }
    return ok({ queued: jobs.length, skipped: pending.length - jobs.length });
  } catch (error) {
    return toErrorResponse(error);
  }
}
