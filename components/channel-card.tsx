import Link from "next/link";
import { Clapperboard } from "lucide-react";

type ChannelCardProps = { id: string; name: string; channelType: string; itemCount: number; publishState: "unpublished" | "incomplete" | "published" };

export function ChannelCard(channel: ChannelCardProps) {
  return (
    <Link href={`/channels/${channel.id}`} className="card channel-card">
      <div className="channel-thumb"><Clapperboard size={26} /></div>
      <div>
        <h3>{channel.name}</h3>
        <div className="meta">
          <span className="badge">{channel.channelType.replace("_", " ")}</span>
          <span>{channel.itemCount} item{channel.itemCount === 1 ? "" : "s"}</span>
          {channel.publishState === "published" ? <span className="badge complete">Published</span> : null}
          {/* Linked to a Tunarr channel, but the last publish attempt never reached its guide-verification
              step -- see the comment on publishState in app/channels/page.tsx. Distinct from "Published"
              on purpose: this channel may be sitting in a half-published state on Tunarr's side. */}
          {channel.publishState === "incomplete" ? <span className="badge pending">Publish incomplete</span> : null}
        </div>
      </div>
    </Link>
  );
}
