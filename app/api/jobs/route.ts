import { ok, serialize, toErrorResponse } from "@/lib/api";
import { listJobs, setJobsPaused } from "@/lib/jobs/service";
import { jobsPauseSchema } from "@/lib/validation";

export async function GET() {
  try {
    return ok(serialize(await listJobs()));
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
