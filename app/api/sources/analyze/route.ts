import { analyzeSourceSchema } from "@/lib/validation";
import { analyzeAndStoreDraft } from "@/lib/sources/service";
import { ok, toErrorResponse } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const input = analyzeSourceSchema.parse(await request.json());
    return ok(await analyzeAndStoreDraft(input.url, { feedType: input.feedType, historyLimit: input.historyLimit }, request.signal), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
