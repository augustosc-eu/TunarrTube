import { openApiDocument } from "@/lib/openapi/document";

export function GET() {
  return Response.json(openApiDocument, {
    headers: { "Cache-Control": "public, max-age=300" }
  });
}
