import { db } from "@/lib/db/client";
import { ensureBuiltInTemplates } from "@/lib/overlay/service";
import { PageHeader } from "@/components/page-header";
import { ChannelForm } from "@/components/channel-form";

export const dynamic = "force-dynamic";

export default async function NewChannelPage() {
  await ensureBuiltInTemplates();
  const templates = await db.overlayTemplate.findMany({ orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }], select: { id: true, name: true, channelType: true, isBuiltIn: true } });
  return <>
    <PageHeader eyebrow="New channel" title="Create a channel" />
    <ChannelForm templates={templates} />
  </>;
}
