import { ok, toErrorResponse } from "@/lib/api";
import { translatePathForTunarr, translatePathWithMappings } from "@/lib/settings/service";

export async function GET(request: Request) {
  try {
    const input = new URL(request.url).searchParams.get("path");
    if (!input) return new Response(null, { status: 400 });
    return ok({ input, output: await translatePathForTunarr(input) });
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { path?: unknown; mappings?: unknown };
    if (typeof body.path !== "string" || !Array.isArray(body.mappings)) return new Response(null, { status: 400 });
    const mappings = body.mappings.flatMap((item) => item && typeof item === "object" && "ytarrPrefix" in item && "tunarrPrefix" in item && typeof item.ytarrPrefix === "string" && typeof item.tunarrPrefix === "string" ? [{ ytarrPrefix: item.ytarrPrefix, tunarrPrefix: item.tunarrPrefix }] : []);
    if (mappings.length !== body.mappings.length) return new Response(null, { status: 400 });
    return ok({ input: body.path, output: translatePathWithMappings(body.path, mappings) });
  } catch (error) { return toErrorResponse(error); }
}
