import { ok, serialize, toErrorResponse } from "@/lib/api";
import { listJobs } from "@/lib/jobs/service";

export async function GET() {
  try {
    return ok(serialize(await listJobs()));
  } catch (error) {
    return toErrorResponse(error);
  }
}
