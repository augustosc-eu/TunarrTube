import { db } from "@/lib/db/client";
import { ensureBuiltInTemplates } from "@/lib/overlay/service";
import { PageHeader } from "@/components/page-header";
import { ChannelCreateTabs } from "@/components/channel-create-tabs";

export const dynamic = "force-dynamic";

export default async function NewChannelPage() {
  await ensureBuiltInTemplates();
  const [templates, sources] = await Promise.all([
    db.overlayTemplate.findMany({ orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }], select: { id: true, name: true, channelType: true, isBuiltIn: true } }),
    db.source.findMany({ orderBy: { updatedAt: "desc" }, select: { id: true, name: true } })
  ]);
  return <>
    <PageHeader eyebrow="New channel" title="Create a channel" />
    <ChannelCreateTabs templates={templates} sources={sources} />
  </>;
}
