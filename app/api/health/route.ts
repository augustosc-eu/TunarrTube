import { db } from "@/lib/db/client";
import { schedulerStatus } from "@/lib/jobs/scheduler";
import { sanitizeLogValue } from "@/lib/logging/sanitize";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    const scheduler = schedulerStatus();
    return Response.json({ status: scheduler.started ? "ready" : "starting", database: "ok", scheduler }, { status: scheduler.started ? 200 : 503 });
  } catch (error) {
    // Unauthenticated (the Docker HEALTHCHECK calls it -- see proxy.ts), so keep the raw database error
    // in the server log rather than the response.
    console.error(sanitizeLogValue(`Health check failed: ${error instanceof Error ? error.message : String(error)}`));
    return Response.json({ status: "unhealthy", database: "error" }, { status: 503 });
  }
}
