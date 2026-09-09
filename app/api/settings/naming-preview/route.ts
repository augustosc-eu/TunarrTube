import path from "node:path";
import { AppError, ok, toErrorResponse } from "@/lib/api";
import { NAMING_SCHEMES, resolveVideoPaths, type NamingScheme } from "@/lib/naming/service";

// Sample (source, video) pair used to preview a naming scheme/template against, purely a display aid --
// no DB/fs access, same shape as /api/settings/path-preview. Mirrors what a real "template"/"tvshow"
// filename would look like without requiring an actual download. MEDIA_ROOT_PLACEHOLDER stands in for
// whatever the real media directory ends up being -- stripped back off below so the preview reads as a
// path relative to it, the part a naming scheme/template actually controls.
const MEDIA_ROOT_PLACEHOLDER = "__media_root__";
const SAMPLE_SOURCE = { name: "Sample Channel" };
const SAMPLE_VIDEO = { youtubeId: "dQw4w9WgXcQ", title: "Sample Video Title", uploadDate: new Date("2026-03-15T00:00:00Z") };

export async function POST(request: Request) {
  try {
    const body = await request.json() as { scheme?: unknown; template?: unknown };
    if (typeof body.scheme !== "string" || !(NAMING_SCHEMES as readonly string[]).includes(body.scheme)) {
      throw new AppError("INVALID_NAMING_SCHEME", "scheme must be one of: id, template, tvshow.", 400);
    }
    const scheme = body.scheme as NamingScheme;
    const template = typeof body.template === "string" && body.template.trim() ? body.template : "{title}";
    const resolved = resolveVideoPaths({
      mediaDirectory: MEDIA_ROOT_PLACEHOLDER,
      scheme,
      template,
      source: SAMPLE_SOURCE,
      video: SAMPLE_VIDEO,
      season: scheme === "tvshow" ? 2026 : null,
      episode: scheme === "tvshow" ? 7 : null
    });
    const fullPath = path.posix.join(resolved.directory, `${resolved.basename}.mp4`);
    const relativePath = fullPath.startsWith(`${MEDIA_ROOT_PLACEHOLDER}/`) ? fullPath.slice(MEDIA_ROOT_PLACEHOLDER.length + 1) : fullPath;
    return ok({ scheme, template, path: relativePath, showNfo: resolved.showNfoPath !== null });
  } catch (error) {
    return toErrorResponse(error);
  }
}
