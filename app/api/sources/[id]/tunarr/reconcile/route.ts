import { ok, toErrorResponse } from "@/lib/api";
import { reconcileTunarrLink } from "@/lib/tunarr/service";
import { reconcileTunarrSchema } from "@/lib/validation";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const input = reconcileTunarrSchema.parse(await request.json()); return ok(await reconcileTunarrLink((await params).id, input.channelId, request.signal)); } catch (error) { return toErrorResponse(error); }
}
