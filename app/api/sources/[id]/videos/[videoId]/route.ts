import { ok, toErrorResponse } from "@/lib/api";
import { removeVideoFromSource } from "@/lib/sources/service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; videoId: string }> }) {
  try {
    const { id, videoId } = await params;
    return ok(await removeVideoFromSource(id, videoId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
