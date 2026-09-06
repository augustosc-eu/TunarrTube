import { getChannel } from "@/lib/channels/service";
import { PageHeader } from "@/components/page-header";
import { AddChannelItemsForm } from "@/components/add-channel-items-form";
import { ChannelItemTable } from "@/components/channel-item-table";
import { ChannelTunarrPublishForm } from "@/components/channel-tunarr-publish-form";

export const dynamic = "force-dynamic";

export default async function ChannelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const channel = await getChannel(id);

  return <>
    <PageHeader eyebrow={`${channel.channelType.replace("_", " ")} · ${channel.template.name}`} title={channel.name} />
    <AddChannelItemsForm channelId={channel.id} />
    <ChannelItemTable
      channelId={channel.id}
      templateId={channel.templateId}
      items={channel.items.map((item) => ({
        mediaItemId: item.mediaItemId,
        mediaItem: {
          id: item.mediaItem.id,
          title: item.mediaItem.title,
          artist: item.mediaItem.artist,
          album: item.mediaItem.album,
          metadataStatus: item.mediaItem.metadataStatus,
          originType: item.mediaItem.originType,
          originLocalPath: item.mediaItem.originLocalPath,
          downloadStatus: item.mediaItem.sourceVideo?.downloadStatus ?? null,
          renders: item.mediaItem.renders.map((render) => ({ templateId: render.templateId, status: render.status }))
        }
      }))}
    />
    <div style={{ marginTop: 24 }}>
      <ChannelTunarrPublishForm channelId={channel.id} />
    </div>
  </>;
}
