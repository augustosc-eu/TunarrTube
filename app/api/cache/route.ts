import { ok, serialize, toErrorResponse } from "@/lib/api";
import { cacheDashboard, enforceCachePolicy } from "@/lib/cache/service";
import { cacheEnforceSchema } from "@/lib/validation";

export async function GET() { try { return ok(serialize(await cacheDashboard())); } catch (error) { return toErrorResponse(error); } }
export async function POST(request: Request) {
  try { const input = cacheEnforceSchema.parse(await request.json()); return ok(serialize(await enforceCachePolicy(input.action === "clear"))); }
  catch (error) { return toErrorResponse(error); }
}
