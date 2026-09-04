import Link from "next/link";
import { ListVideo, Plus } from "lucide-react";
import { db } from "@/lib/db/client";
import { PageHeader } from "@/components/page-header";
import { SourceCard } from "@/components/source-card";

export const dynamic = "force-dynamic";

const DASHBOARD_SOURCE_LIMIT = 8;

export default async function DashboardPage() {
  const [sourceCount, sources, videoCount, downloadedCount] = await Promise.all([
    db.source.count(),
    db.source.findMany({ orderBy: { updatedAt: "desc" }, include: { _count: { select: { videos: { where: { membershipStatus: "present" } } } } }, take: DASHBOARD_SOURCE_LIMIT }),
    db.video.count(),
    db.sourceVideo.count({ where: { downloadStatus: "complete" } })
  ]);
  return <><PageHeader eyebrow="Local YouTube library" title="Dashboard" action={<Link className="button" href="/sources/new"><Plus size={16} /> Add YouTube Source</Link>} /><div className="stat-grid"><div className="stat"><span>Sources</span><strong>{sourceCount}</strong></div><div className="stat"><span>Unique videos</span><strong>{videoCount}</strong></div><div className="stat"><span>Downloaded assets</span><strong>{downloadedCount}</strong></div></div><div className="page-header" style={{ marginBottom: 16 }}><h2 style={{ margin: 0 }}>Sources</h2>{sourceCount > DASHBOARD_SOURCE_LIMIT ? <Link className="muted" href="/sources">View all {sourceCount} sources →</Link> : null}</div>{sources.length ? <div className="grid">{sources.map((source) => <SourceCard key={source.id} {...source} count={source._count.videos} />)}</div> : <div className="empty"><ListVideo size={32} /><h2>No sources yet</h2><p>Analyze a YouTube playlist to start building your local library.</p><Link className="button" href="/sources/new">Add your first source</Link></div>}</>;
}
