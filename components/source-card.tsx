import Image from "next/image";
import Link from "next/link";
import { ListVideo } from "lucide-react";

type SourceCardProps = { id: string; name: string; uploaderName: string | null; thumbnailUrl: string | null; thumbnailPath?: string | null; sourceType?: string; playbackMode?: string; count: number; lastSyncedAt: Date | null };

export function SourceCard(source: SourceCardProps) {
  return (
    <Link className="card source-card" href={`/sources/${source.id}`}>
      {source.thumbnailPath || source.thumbnailUrl ? <Image className="source-thumb" src={source.thumbnailPath ? `/api/thumbnails/source/${source.id}` : source.thumbnailUrl!} width={144} height={144} alt="" unoptimized={Boolean(source.thumbnailPath)} /> : <span className="source-thumb placeholder"><ListVideo /></span>}
      <div><h3>{source.name}</h3><div className="meta"><span>YouTube {source.sourceType ?? "playlist"}</span><span>·</span><span>{source.count} videos</span>{source.playbackMode ? <><span>·</span><span>{source.playbackMode}</span></> : null}</div><div className="meta" style={{ marginTop: 7 }}>{source.lastSyncedAt ? `Synced ${source.lastSyncedAt.toLocaleString()}` : source.uploaderName ?? "Not synced yet"}</div></div>
    </Link>
  );
}
