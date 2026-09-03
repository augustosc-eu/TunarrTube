import { ok, toErrorResponse } from "@/lib/api";
import { db } from "@/lib/db/client";

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
