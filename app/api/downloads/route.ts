import { ok, serialize, toErrorResponse } from "@/lib/api";
import { enqueueDownloads } from "@/lib/jobs/service";
import { downloadSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const input = downloadSchema.parse(await request.json());
    return ok(serialize(await enqueueDownloads(input.items)), { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
