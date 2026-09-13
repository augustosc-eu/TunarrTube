import { ok, toErrorResponse } from "@/lib/api";
import { previewChannelSchedule } from "@/lib/programming/director";
import { directorPreviewSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

// AI Programming Director "Preview" step -- synchronous (not queued as a Job, unlike content-select)
// because it's an interactive, iterate-and-regenerate workflow: the user is actively waiting to review
// the result before deciding whether to Apply. Never mutates the channel or touches Tunarr -- see
// lib/programming/director.ts's module comment for the full flow.
export const runtime = "nodejs";

export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const input = directorPreviewSchema.parse(await request.json());
    const preview = await previewChannelSchedule(id, {
      instructions: input.instructions, scheduleStyle: input.scheduleStyle, providerOverride: input.aiProvider, signal: request.signal
    });
    return ok(preview);
  } catch (error) {
    return toErrorResponse(error);
  }
}
