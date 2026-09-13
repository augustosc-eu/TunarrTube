import { ok, toErrorResponse } from "@/lib/api";
import { revealRenderedAsset } from "@/lib/renders/service";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    await revealRenderedAsset(id);
    return ok({ revealed: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
