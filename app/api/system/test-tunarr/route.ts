import { ok, serialize, toErrorResponse } from "@/lib/api";
import { testTunarrConnection } from "@/lib/tunarr/service";
import { testTunarrSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = testTunarrSchema.parse(await request.json());
    return ok(serialize(await testTunarrConnection(input.tunarrUrl, request.signal)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
