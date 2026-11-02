import { ok, toErrorResponse } from "@/lib/api";
import { completeSetup } from "@/lib/settings/service";
import { completeSetupSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    return ok(await completeSetup(completeSetupSchema.parse(await request.json())));
  } catch (error) {
    return toErrorResponse(error);
  }
}
