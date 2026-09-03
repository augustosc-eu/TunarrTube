import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SourceCard } from "@/components/source-card";
import { listSources } from "@/lib/sources/service";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const sources = await listSources();
  return <><PageHeader eyebrow="YouTube inputs" title="Sources" action={<Link className="button" href="/sources/new"><Plus size={16} /> Add Source</Link>} />{sources.length ? <div className="grid">{sources.map((source) => <SourceCard key={source.id} {...source} count={source._count.videos} />)}</div> : <div className="empty"><h2>No sources configured</h2><p>Add an individual video, playlist, or channel to begin.</p></div>}</>;
}
