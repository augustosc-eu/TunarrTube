import { ok, toErrorResponse } from "@/lib/api";
import { tunarrLinkStatus } from "@/lib/tunarr/service";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return ok(await tunarrLinkStatus((await params).id, request.signal)); } catch (error) { return toErrorResponse(error); }
}
