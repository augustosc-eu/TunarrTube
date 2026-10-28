import { ok, toErrorResponse } from "@/lib/api";
import { updateSiteSetting } from "@/lib/settings/service";
import { siteIdSchema, updateSiteSettingSchema } from "@/lib/validation";

type Context = { params: Promise<{ site: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const site = siteIdSchema.parse((await params).site);
    return ok(await updateSiteSetting(site, updateSiteSettingSchema.parse(await request.json())));
  } catch (error) {
    return toErrorResponse(error);
  }
}
