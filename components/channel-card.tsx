import Link from "next/link";
import { Clapperboard } from "lucide-react";

type ChannelCardProps = { id: string; name: string; channelType: string; itemCount: number; published: boolean };

export function ChannelCard(channel: ChannelCardProps) {
  return (
    <Link href={`/channels/${channel.id}`} className="card channel-card">
      <div className="channel-thumb"><Clapperboard size={26} /></div>
      <div>
        <h3>{channel.name}</h3>
        <div className="meta">
          <span className="badge">{channel.channelType.replace("_", " ")}</span>
          <span>{channel.itemCount} item{channel.itemCount === 1 ? "" : "s"}</span>
          {channel.published ? <span className="badge complete">Published</span> : null}
        </div>
      </div>
    </Link>
  );
}
