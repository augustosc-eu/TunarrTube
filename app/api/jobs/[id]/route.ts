import { ok, serialize, toErrorResponse } from "@/lib/api";
import { getJob } from "@/lib/jobs/service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return ok(serialize(await getJob((await params).id)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
