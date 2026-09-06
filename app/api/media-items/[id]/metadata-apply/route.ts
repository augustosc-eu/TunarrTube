import { ok, serialize, toErrorResponse } from "@/lib/api";
import { applyMetadata } from "@/lib/metadata-lookup/service";
import { metadataCandidateSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const candidate = metadataCandidateSchema.parse(await request.json());
    return ok(serialize(await applyMetadata((await params).id, candidate)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
