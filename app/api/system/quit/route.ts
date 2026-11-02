import { ok, toErrorResponse } from "@/lib/api";
import { quitAvailable, requestQuit } from "@/lib/system/quit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return ok({ available: quitAvailable() });
}

export async function POST() {
  try {
    return ok(await requestQuit());
  } catch (error) {
    return toErrorResponse(error);
  }
}
