import { ok, serialize, toErrorResponse } from "@/lib/api";
import { db } from "@/lib/db/client";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sourceId = url.searchParams.get("sourceId") ?? undefined;
    const videos = await db.video.findMany({
      where: sourceId ? { sources: { some: { sourceId } } } : undefined,
      orderBy: { createdAt: "desc" },
      include: { sources: { include: { source: { select: { id: true, name: true } } } } }
    });
    return ok(serialize(videos));
  } catch (error) {
    return toErrorResponse(error);
  }
}
