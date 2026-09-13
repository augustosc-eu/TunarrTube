import { ok, serialize, toErrorResponse } from "@/lib/api";
import { db } from "@/lib/db/client";
import { ensureBuiltInTemplates } from "@/lib/overlay/service";
import { createTemplateSchema } from "@/lib/validation";

export async function GET() {
  try {
    await ensureBuiltInTemplates();
    return ok(serialize(await db.overlayTemplate.findMany({ orderBy: [{ isBuiltIn: "desc" }, { updatedAt: "desc" }] })));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createTemplateSchema.parse(await request.json());
    return ok(serialize(await db.overlayTemplate.create({ data: input })), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
