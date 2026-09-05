import { ok, serialize, toErrorResponse } from "@/lib/api";
import { cancelJob, getJob, postponeJob, retryJob, stopJob } from "@/lib/jobs/service";
import { jobMutationSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return ok(serialize(await getJob((await params).id)));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const input = jobMutationSchema.parse(await request.json());
    if (input.action === "cancel") return ok(serialize(await cancelJob(id)));
    if (input.action === "stop") return ok(serialize(await stopJob(id)));
    if (input.action === "postpone") return ok(serialize(await postponeJob(id, input.postponeMinutes!)));
    return ok(serialize(await retryJob(id)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
