import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db/client";

export const dynamic = "force-dynamic";

function duration(seconds: number | null) {
  if (seconds == null) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default async function VideosPage() {
  const videos = await db.video.findMany({ orderBy: { createdAt: "desc" }, include: { sources: { include: { source: { select: { name: true } } } } } });
  return <><PageHeader eyebrow="Canonical library" title="Videos" />{videos.length ? <div className="table-wrap"><table><thead><tr><th>Video</th><th>Duration</th><th>Sources</th><th>Availability</th></tr></thead><tbody>{videos.map((video) => <tr key={video.id}>
    <td className="title-cell"><strong>{video.title}</strong><span className="meta">{video.uploader ?? video.youtubeId}</span></td>
    <td>{duration(video.durationSeconds)}</td>
    <td>{video.sources.map((membership) => membership.source.name).join(", ")}</td>
    <td><span className={`badge ${video.availability}`}>{video.availability}</span>{video.availabilityReason ? <span className="availability-reason">{video.availabilityReason}</span> : null}</td>
  </tr>)}</tbody></table></div> : <div className="empty"><h2>No videos yet</h2><p>Videos appear here after a source is added.</p></div>}</>;
}
