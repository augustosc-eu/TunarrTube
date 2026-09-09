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
      published: Boolean(channel.tunarrChannelId)
    }))} />
  </>;
}
