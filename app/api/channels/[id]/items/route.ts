import { ok, serialize, toErrorResponse } from "@/lib/api";
import { db } from "@/lib/db/client";
import { addYoutubeUrlToChannel, attachExistingVideo, enqueueChannelJob } from "@/lib/channels/service";
import { addChannelItemSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const input = addChannelItemSchema.parse(await request.json());
    if (input.type === "local") {
      const job = await enqueueChannelJob("ingest_local_scan", { channelId: id }, { folderPath: input.folder });
      return ok({ queued: true, jobId: job.id });
    }
    if (input.type === "existingVideo") {
      const mediaItem = await attachExistingVideo(id, input.sourceVideoId);
      return ok(serialize({ mediaItemId: mediaItem.id }));
    }
    const result = await addYoutubeUrlToChannel(id, input.url, request.signal);
    return ok(serialize({ addedCount: result.addedCount, duplicateCount: result.duplicateCount, mediaItemIds: result.mediaItems.map((item) => item.id) }));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const { mediaItemId } = (await request.json()) as { mediaItemId: string };
    await db.channelItem.delete({ where: { channelId_mediaItemId: { channelId: id, mediaItemId } } });
    return ok({ removed: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
