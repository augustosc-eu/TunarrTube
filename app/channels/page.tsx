import Link from "next/link";
import { Plus } from "lucide-react";
import { listChannels } from "@/lib/channels/service";
import { PageHeader } from "@/components/page-header";
import { ChannelList } from "@/components/channel-list";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const channels = await listChannels();
  return <>
    <PageHeader eyebrow="Channels" title="Channels" action={<Link className="button" href="/channels/new"><Plus size={16} /> New channel</Link>} />
    <ChannelList channels={channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      channelType: channel.channelType,
      itemCount: channel._count.items,
      // tunarrChannelId alone only means a publish attempt got as far as creating/finding the remote
      // channel -- tunarrLastPublishedAt is set once, at the very end, only after the programming/
      // schedule write and its guide-verification both succeed (see channelTunarrLinkStatus's comment
      // in lib/tunarr/channel-service.ts). A channel can be linked without ever having finished a
      // publish successfully, which "incomplete" surfaces instead of the misleading plain "Published".
      publishState: channel.tunarrLastPublishedAt ? "published" as const : channel.tunarrChannelId ? "incomplete" as const : "unpublished" as const
    }))} />
  </>;
}
