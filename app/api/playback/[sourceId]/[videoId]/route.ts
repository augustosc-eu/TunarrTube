import { toErrorResponse } from "@/lib/api";
import { playbackResponse } from "@/lib/playback/service";

type Context = { params: Promise<{ sourceId: string; videoId: string }> };
async function respond(request: Request, context: Context, head: boolean) {
  try { const { sourceId, videoId } = await context.params; return await playbackResponse(sourceId, videoId, request, head); }
  catch (error) { return toErrorResponse(error); }
}
export async function GET(request: Request, context: Context) { return respond(request, context, false); }
export async function HEAD(request: Request, context: Context) { return respond(request, context, true); }
