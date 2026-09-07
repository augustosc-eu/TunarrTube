import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { deleteTemplate } from "@/lib/overlay/service";
import { createChannel } from "@/lib/channels/service";

const cleanupTemplateIds: string[] = [];
const cleanupChannelIds: string[] = [];
const cleanupDirs: string[] = [];
const cleanupMediaItemIds: string[] = [];

afterEach(async () => {
  await db.channel.deleteMany({ where: { id: { in: cleanupChannelIds.splice(0) } } });
  await db.renderedAsset.deleteMany({ where: { mediaItemId: { in: cleanupMediaItemIds } } });
  await db.mediaItem.deleteMany({ where: { id: { in: cleanupMediaItemIds.splice(0) } } });
  await db.overlayTemplate.deleteMany({ where: { id: { in: cleanupTemplateIds.splice(0) } } });
  await Promise.all(cleanupDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeTemplate(overrides: Partial<{ isBuiltIn: boolean }> = {}) {
  const template = await db.overlayTemplate.create({
    data: { name: "Test Template", htmlTemplate: "<div>{{title}}</div>", bindingsJson: "[]", layersJson: "[]", ...overrides }
  });
  cleanupTemplateIds.push(template.id);
  return template;
}

describe("deleteTemplate", () => {
  it("deletes a template that isn't built-in and isn't assigned to a channel", async () => {
    const template = await makeTemplate();
    await deleteTemplate(template.id);
    cleanupTemplateIds.pop();
    expect(await db.overlayTemplate.findUnique({ where: { id: template.id } })).toBeNull();
  });

  it("refuses to delete a built-in template", async () => {
    const template = await makeTemplate({ isBuiltIn: true });
    await expect(deleteTemplate(template.id)).rejects.toMatchObject({ code: "TEMPLATE_BUILT_IN" });
  });

  it("refuses to delete a template still assigned to a channel", async () => {
    const template = await makeTemplate();
    const channel = await createChannel({ name: `Test Channel ${Date.now()}-${Math.random()}`, templateId: template.id });
    cleanupChannelIds.push(channel.id);
    cleanupDirs.push(channel.storageDirectory);

    await expect(deleteTemplate(template.id)).rejects.toMatchObject({ code: "TEMPLATE_IN_USE" });
    expect(await db.overlayTemplate.findUnique({ where: { id: template.id } })).not.toBeNull();
  });

  it("throws TEMPLATE_NOT_FOUND for an unknown id", async () => {
    await expect(deleteTemplate("nonexistent-id")).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
  });

  it("refuses to delete a template that still has a RenderedAsset, instead of throwing a raw FK-constraint error", async () => {
    // RenderedAsset.templateId has no onDelete action (defaults to restrict) -- without this check,
    // deleting a template that was rendered at least once (even if no channel currently uses it) hits
    // the FK constraint directly and surfaces as an unhandled PrismaClientKnownRequestError / 500
    // instead of the app's normal AppError/friendly-message convention.
    const template = await makeTemplate();
    const mediaItem = await db.mediaItem.create({
      data: { originType: "local", originLocalPath: "/tmp/does-not-matter.mp4", title: "Test Item" }
    });
    cleanupMediaItemIds.push(mediaItem.id);
    await db.renderedAsset.create({
      data: { mediaItemId: mediaItem.id, templateId: template.id, status: "complete", outputPath: "/tmp/out.mp4" }
    });

    await expect(deleteTemplate(template.id)).rejects.toMatchObject({ code: "TEMPLATE_HAS_RENDERS" });
    expect(await db.overlayTemplate.findUnique({ where: { id: template.id } })).not.toBeNull();
  });
});
