import { ok, serialize, toErrorResponse } from "@/lib/api";
import { mutateCacheAsset } from "@/lib/cache/service";
import { cacheMutationSchema } from "@/lib/validation";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const input = cacheMutationSchema.parse(await request.json()); return ok(serialize(await mutateCacheAsset((await params).id, input.action))); }
  catch (error) { return toErrorResponse(error); }
}
