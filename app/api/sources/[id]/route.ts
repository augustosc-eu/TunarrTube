import { db } from "@/lib/db/client";
import { ok, serialize, toErrorResponse } from "@/lib/api";
import { deleteSource, getSource } from "@/lib/sources/service";
import { patchSourceSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return ok(serialize(await getSource((await params).id)));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const input = patchSourceSchema.parse(await request.json());
    const nextSyncAt = input.syncEnabled === true || input.syncIntervalMinutes
      ? new Date(Date.now() + (input.syncIntervalMinutes ?? (await db.source.findUniqueOrThrow({ where: { id }, select: { syncIntervalMinutes: true } })).syncIntervalMinutes) * 60_000)
      : input.syncEnabled === false ? null : undefined;
    const source = await db.source.update({ where: { id }, data: { ...input, nextSyncAt } });
    if (input.playbackMode === "download") {
      const memberships = await db.sourceVideo.findMany({ where: { sourceId: id, membershipStatus: "present", downloadStatus: { not: "complete" } }, select: { videoId: true } });
      const { enqueueUniqueJob } = await import("@/lib/sources/service");
      for (const membership of memberships) await enqueueUniqueJob("download", id, membership.videoId, { target: "permanent" });
      const { kickWorker } = await import("@/lib/jobs/runner"); kickWorker();
    }
    return ok(source);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    return ok(await deleteSource((await params).id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
