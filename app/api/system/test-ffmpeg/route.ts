import { ok, toErrorResponse } from "@/lib/api";
import { inspectBinary } from "@/lib/system/binaries";

export async function POST() {
  try {
    return ok(await inspectBinary("ffmpeg"));
  } catch (error) {
    return toErrorResponse(error);
  }
}
