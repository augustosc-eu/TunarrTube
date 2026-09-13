import { ok, serialize, toErrorResponse } from "@/lib/api";
import { listJobs, setJobsPaused } from "@/lib/jobs/service";
import { jobsListQuerySchema, jobsPauseSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const query = jobsListQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return ok(serialize(await listJobs(query)));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { paused } = jobsPauseSchema.parse(await request.json());
    return ok(serialize(await setJobsPaused(paused)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
