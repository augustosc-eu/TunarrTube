import { ok, toErrorResponse } from "@/lib/api";
import { getSiteSettingsView } from "@/lib/settings/service";

export async function GET() {
  try {
    return ok(await getSiteSettingsView());
  } catch (error) {
    return toErrorResponse(error);
  }
}
