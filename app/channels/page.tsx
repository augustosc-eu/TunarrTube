import Link from "next/link";
import { Clapperboard, Plus } from "lucide-react";
import { listChannels } from "@/lib/channels/service";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const channels = await listChannels();
  return <>
    <PageHeader eyebrow="Channels" title="Channels" action={<Link className="button" href="/channels/new"><Plus size={16} /> New channel</Link>} />
    {channels.length ? (
      <div className="grid">
        {channels.map((channel) => (
          <Link key={channel.id} href={`/channels/${channel.id}`} className="card channel-card">
            <div className="channel-thumb"><Clapperboard size={26} /></div>
            <div>
              <h3>{channel.name}</h3>
              <div className="meta">
                <span className="badge">{channel.channelType.replace("_", " ")}</span>
                <span>{channel._count.items} item{channel._count.items === 1 ? "" : "s"}</span>
                {channel.tunarrChannelId ? <span className="badge complete">Published</span> : null}
              </div>
            </div>
          </Link>
        ))}
      </div>
    ) : (
      <div className="empty">
        <Clapperboard size={32} />
        <h2>No channels yet</h2>
        <p>Create a channel, add local files, an existing downloaded video, or a YouTube URL, attach metadata, and burn in the overlay before publishing to Tunarr.</p>
        <Link className="button" href="/channels/new">Create your first channel</Link>
      </div>
    )}
  </>;
}
