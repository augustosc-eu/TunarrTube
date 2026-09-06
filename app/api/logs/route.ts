import { ok, toErrorResponse } from "@/lib/api";
import { db } from "@/lib/db/client";
import { purgeLogs } from "@/lib/logging/service";
import { getSettings } from "@/lib/settings/service";
import { logsPurgeSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const category = url.searchParams.get("category") ?? undefined;
    const logs = await db.logEntry.findMany({ where: category ? { category } : undefined, orderBy: { createdAt: "desc" }, take: 500 });
    return ok(logs);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = logsPurgeSchema.parse(await request.json());
    const settings = await getSettings();
    return ok(await purgeLogs(settings.logRetentionDays, input.action === "clear"));
  } catch (error) {
    return toErrorResponse(error);
  }
}
