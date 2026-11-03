import { ok, toErrorResponse } from "@/lib/api";
import { getSettings } from "@/lib/settings/service";
import { browseDirectory, createDirectory } from "@/lib/settings/storage";
import { browseDirectoryQuerySchema, createDirectorySchema } from "@/lib/validation";

export const runtime = "nodejs";

// Lists the subdirectories of ?path= (default: the current media directory) for the folder and file
// pickers; ?files=cookies|executable also lists that kind of file.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = browseDirectoryQuerySchema.parse({ path: params.get("path") ?? undefined, files: params.get("files") ?? undefined });
    const { mediaBaseDirectory } = await getSettings();
    return ok(await browseDirectory(query.path ?? mediaBaseDirectory, mediaBaseDirectory, query.files));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createDirectorySchema.parse(await request.json());
    return ok(await createDirectory(input.parent, input.name));
  } catch (error) {
    return toErrorResponse(error);
  }
}
