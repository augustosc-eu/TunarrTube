import { ok, toErrorResponse } from "@/lib/api";
import { getSettingsView, updateSettings } from "@/lib/settings/service";
import { settingsSchema } from "@/lib/validation";

export async function GET() {
  try {
    return ok(await getSettingsView());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = settingsSchema.parse(await request.json());
    return ok(await updateSettings(input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
