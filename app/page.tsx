import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db/client";
import { PageHeader } from "@/components/page-header";
import { SourceCard } from "@/components/source-card";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [sources, videoCount, downloadedCount] = await Promise.all([
    db.source.findMany({ orderBy: { updatedAt: "desc" }, include: { _count: { select: { videos: { where: { membershipStatus: "present" } } } } }, take: 8 }),
    db.video.count(),
    db.sourceVideo.count({ where: { downloadStatus: "complete" } })
  ]);
  return <><PageHeader eyebrow="Local YouTube library" title="Dashboard" action={<Link className="button" href="/sources/new"><Plus size={16} /> Add YouTube Source</Link>} /><div className="stat-grid"><div className="stat"><span>Sources</span><strong>{sources.length}</strong></div><div className="stat"><span>Unique videos</span><strong>{videoCount}</strong></div><div className="stat"><span>Downloaded assets</span><strong>{downloadedCount}</strong></div></div><h2>Sources</h2>{sources.length ? <div className="grid">{sources.map((source) => <SourceCard key={source.id} {...source} count={source._count.videos} />)}</div> : <div className="empty"><h2>No sources yet</h2><p>Analyze a YouTube playlist to start building your local library.</p><Link className="button" href="/sources/new">Add your first source</Link></div>}</>;
}
