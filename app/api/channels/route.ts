import { ok, serialize, toErrorResponse } from "@/lib/api";
import { createChannel, listChannels } from "@/lib/channels/service";
import { createChannelSchema } from "@/lib/validation";

export async function GET() {
  try {
    return ok(serialize(await listChannels()));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createChannelSchema.parse(await request.json());
    return ok(serialize(await createChannel(input)), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
