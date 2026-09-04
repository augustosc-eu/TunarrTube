import { ok, serialize, toErrorResponse } from "@/lib/api";
import { createSourceFromDraft, listSources } from "@/lib/sources/service";
import { createSourceSchema } from "@/lib/validation";

export async function GET() {
  try {
    return ok(serialize(await listSources()));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createSourceSchema.parse(await request.json());
    return ok(serialize(await createSourceFromDraft(input.draftId, input.name, input.playbackMode, input.syncEnabled, input.syncIntervalMinutes, input.videoQuality ?? null)), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
