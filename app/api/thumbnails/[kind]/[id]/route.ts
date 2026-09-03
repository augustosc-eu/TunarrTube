import { toErrorResponse } from "@/lib/api";
import { thumbnailResponse } from "@/lib/thumbnails/service";

export async function GET(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const { kind, id } = await params;
    if (kind !== "source" && kind !== "video") return new Response(null, { status: 404 });
    return await thumbnailResponse(kind, id, request);
  } catch (error) { return toErrorResponse(error); }
}
