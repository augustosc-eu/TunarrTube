import { ok, toErrorResponse } from "@/lib/api";
import { updateBinary } from "@/lib/system/binaries";

export async function POST() {
  try {
    return ok(await updateBinary("yt-dlp"));
  } catch (error) {
    return toErrorResponse(error);
  }
}
