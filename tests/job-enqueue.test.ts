import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { enqueueActiveJob } from "@/lib/jobs/enqueue";

const cleanupJobIds: string[] = [];
const cleanupMediaItemIds: string[] = [];

afterEach(async () => {
  await db.job.deleteMany({ where: { id: { in: cleanupJobIds.splice(0) } } });
  await db.mediaItem.deleteMany({ where: { id: { in: cleanupMediaItemIds.splice(0) } } });
});

describe("atomic job enqueue", () => {
  it("creates exactly one active job under concurrent identical requests", async () => {
    const type = `atomic-test-${Date.now()}-${Math.random()}`;
    const jobs = await Promise.all(Array.from({ length: 20 }, () => enqueueActiveJob({ type })));
    cleanupJobIds.push(...new Set(jobs.map((job) => job.id)));

    expect(new Set(jobs.map((job) => job.id)).size).toBe(1);
    expect(await db.job.count({ where: { type } })).toBe(1);
    expect(jobs[0]?.activeKey).not.toBeNull();
  });

  it("deduplicates renders by media item and template, not media item alone", async () => {
    const mediaItem = await db.mediaItem.create({ data: { originType: "local", originLocalPath: "/tmp/test.mp4", title: "Render key test" } });
    cleanupMediaItemIds.push(mediaItem.id);
    const [templateA, duplicateA, templateB] = await Promise.all([
      enqueueActiveJob({ type: "render", mediaItemId: mediaItem.id, payload: { templateId: "template-a" } }),
      enqueueActiveJob({ type: "render", mediaItemId: mediaItem.id, payload: { templateId: "template-a" } }),
      enqueueActiveJob({ type: "render", mediaItemId: mediaItem.id, payload: { templateId: "template-b" } })
    ]);
    cleanupJobIds.push(templateA.id, templateB.id);

    expect(duplicateA.id).toBe(templateA.id);
    expect(templateB.id).not.toBe(templateA.id);
  });
});
