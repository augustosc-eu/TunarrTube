import { ok, serialize, toErrorResponse } from "@/lib/api";
import { cancelJob, getJob, retryJob } from "@/lib/jobs/service";
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
    const { action } = jobMutationSchema.parse(await request.json());
    return ok(serialize(action === "cancel" ? await cancelJob(id) : await retryJob(id)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
