import { ok, toErrorResponse } from "@/lib/api";
import { enqueueMetadataRepair } from "@/lib/sources/service";

export async function POST() {
  try {
    return ok(await enqueueMetadataRepair());
  } catch (error) {
    return toErrorResponse(error);
  }
}
