import { db } from "@/lib/db/client";

export type ActiveJobInput = {
  type: string;
  sourceId?: string;
  videoId?: string;
  channelId?: string;
  mediaItemId?: string;
  payload?: unknown;
  maxAttempts?: number;
};

const ACTIVE_STATUSES = ["queued", "running"];

export function activeJobKey(input: ActiveJobInput) {
  // Render output is shared by the exact media-item/template pair. Including templateId here means
  // two templates can render the same clip concurrently without either enqueue swallowing the other.
  if (input.type === "render") {
    const templateId = (input.payload as { templateId?: unknown } | undefined)?.templateId;
    if (typeof templateId !== "string" || !templateId) {
      throw new Error("A render job requires a templateId.");
    }
    return JSON.stringify([input.type, input.mediaItemId ?? null, templateId]);
  }
  if (input.channelId || input.mediaItemId) {
    return JSON.stringify([input.type, input.channelId ?? null, input.mediaItemId ?? null]);
  }
  return JSON.stringify([input.type, input.sourceId ?? null, input.videoId ?? null]);
}

export async function enqueueActiveJob(input: ActiveJobInput) {
  const activeKey = activeJobKey(input);
  const data = {
    activeKey,
    type: input.type,
    sourceId: input.sourceId,
    videoId: input.videoId,
    channelId: input.channelId,
    mediaItemId: input.mediaItemId,
    payloadJson: input.payload === undefined ? undefined : JSON.stringify(input.payload),
    maxAttempts: input.maxAttempts ?? (input.type === "tunarr_refresh" ? 100 : 3)
  };

  // The unique activeKey plus a native database upsert makes concurrent enqueue attempts converge
  // on one row without relying on an application-level find-then-create race. A terminal row should
  // already have released its key, but clearing one defensively also makes upgrades/manual DB edits
  // self-healing.
  for (;;) {
    const job = await db.job.upsert({
      where: { activeKey },
      update: { activeKey },
      create: data
    });
    if (ACTIVE_STATUSES.includes(job.status)) return job;
    await db.job.updateMany({
      where: { id: job.id, activeKey, status: { notIn: ACTIVE_STATUSES } },
      data: { activeKey: null }
    });
    // If another enqueue repaired the stale key first, retry and converge on its new active row.
  }
}

export async function enqueueActiveJobs(inputs: ActiveJobInput[]) {
  const jobs = [];
  for (let start = 0; start < inputs.length; start += 100) {
    jobs.push(...await Promise.all(inputs.slice(start, start + 100).map(enqueueActiveJob)));
  }
  return jobs;
}
