import { AppError, ok, serialize, toErrorResponse } from "@/lib/api";
import { db } from "@/lib/db/client";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const video = await db.video.findUnique({ where: { id: (await params).id }, include: { sources: { include: { source: true } } } });
    if (!video) throw new AppError("VIDEO_NOT_FOUND", "Video not found.", 404);
    return ok(serialize(video));
  } catch (error) {
    return toErrorResponse(error);
  }
}
