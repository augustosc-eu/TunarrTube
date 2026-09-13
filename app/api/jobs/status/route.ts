import { ok, serialize, toErrorResponse } from "@/lib/api";
import { getJobsStatus } from "@/lib/jobs/service";
import { jobsStatusSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const { ids } = jobsStatusSchema.parse(await request.json());
    return ok(serialize(await getJobsStatus(ids)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
