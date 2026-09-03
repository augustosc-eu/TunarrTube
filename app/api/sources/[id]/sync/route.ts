import { ok, toErrorResponse } from "@/lib/api";
import { enqueueSync } from "@/lib/sources/service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return ok(await enqueueSync((await params).id), { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
