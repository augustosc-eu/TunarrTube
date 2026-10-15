import { ok, toErrorResponse } from "@/lib/api";
import { translatePathForTunarr, translatePathWithMappings } from "@/lib/settings/service";
import { pathPreviewQuerySchema, pathPreviewSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const { path } = pathPreviewQuerySchema.parse({ path: new URL(request.url).searchParams.get("path") ?? undefined });
    return ok({ input: path, output: await translatePathForTunarr(path) });
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const body = pathPreviewSchema.parse(await request.json());
    return ok({ input: body.path, output: translatePathWithMappings(body.path, body.mappings) });
  } catch (error) { return toErrorResponse(error); }
}
