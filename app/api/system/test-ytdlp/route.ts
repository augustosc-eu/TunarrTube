import { ok, toErrorResponse } from "@/lib/api";
import { inspectBinary } from "@/lib/system/binaries";

export async function POST() {
  try {
    return ok(await inspectBinary("yt-dlp"));
  } catch (error) {
    return toErrorResponse(error);
  }
}
