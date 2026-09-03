import { ok, toErrorResponse } from "@/lib/api";
import { enqueueTunarrPublish, unlinkTunarr } from "@/lib/tunarr/service";
import { publishTunarrSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const input = publishTunarrSchema.parse(await request.json());
    return ok(await enqueueTunarrPublish((await params).id, input), { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return ok(await unlinkTunarr((await params).id)); } catch (error) { return toErrorResponse(error); }
}
