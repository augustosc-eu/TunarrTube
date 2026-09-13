import { toErrorResponse } from "@/lib/api";
import { renderStreamResponse } from "@/lib/renders/service";

type Context = { params: Promise<{ id: string }> };

async function respond(request: Request, context: Context, head: boolean) {
  try {
    const { id } = await context.params;
    return await renderStreamResponse(id, request, head);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function GET(request: Request, context: Context) { return respond(request, context, false); }
export async function HEAD(request: Request, context: Context) { return respond(request, context, true); }
