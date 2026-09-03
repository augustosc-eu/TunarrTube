import { db } from "@/lib/db/client";
import { schedulerStatus } from "@/lib/jobs/scheduler";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    const scheduler = schedulerStatus();
    return Response.json({ status: scheduler.started ? "ready" : "starting", database: "ok", scheduler }, { status: scheduler.started ? 200 : 503 });
  } catch (error) {
    return Response.json({ status: "unhealthy", database: "error", error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
