import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SourceList } from "@/components/source-list";
import { listSources } from "@/lib/sources/service";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const sources = await listSources();
  return <>
    <PageHeader eyebrow="YouTube inputs" title="Sources" action={<Link className="button" href="/sources/new"><Plus size={16} /> Add Source</Link>} />
    <SourceList sources={sources.map((source) => ({ ...source, count: source._count.videos }))} />
  </>;
}
