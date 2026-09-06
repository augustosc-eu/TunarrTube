import { AppError, ok, serialize, toErrorResponse } from "@/lib/api";
import { db } from "@/lib/db/client";
import { updateTemplateSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const template = await db.overlayTemplate.findUnique({ where: { id: (await params).id } });
    if (!template) throw new AppError("TEMPLATE_NOT_FOUND", "Overlay template not found.", 404);
    return ok(serialize(template));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const input = updateTemplateSchema.parse(await request.json());
    const template = await db.overlayTemplate.findUnique({ where: { id } });
    if (!template) throw new AppError("TEMPLATE_NOT_FOUND", "Overlay template not found.", 404);
    return ok(serialize(await db.overlayTemplate.update({ where: { id }, data: input })));
  } catch (error) {
    return toErrorResponse(error);
  }
}
