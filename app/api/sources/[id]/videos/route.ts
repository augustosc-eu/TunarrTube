import { ok, toErrorResponse } from "@/lib/api";
import { addVideosToCollection } from "@/lib/sources/service";
import { addCollectionVideosSchema } from "@/lib/validation";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const input = addCollectionVideosSchema.parse(await request.json());
    return ok(await addVideosToCollection((await params).id, input.urls, request.signal), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
