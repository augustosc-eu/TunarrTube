import { ok, toErrorResponse } from "@/lib/api";
import { preparePlayback } from "@/lib/playback/service";
import { preparePlaybackSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try { return ok(await preparePlaybackSchema.parseAsync(await request.json()).then((input) => preparePlayback(input.sourceId, input.videoId)), { status: 202 }); }
  catch (error) { return toErrorResponse(error); }
}
