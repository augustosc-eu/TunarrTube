import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await searchParams;
  const logs = await db.logEntry.findMany({ where: category ? { category } : undefined, orderBy: { createdAt: "desc" }, take: 500 });
  return <><PageHeader eyebrow="Operational history" title="Logs" /><form className="toolbar"><select className="input" style={{ width: 220 }} name="category" defaultValue={category ?? ""}><option value="">All categories</option><option value="source">Source</option><option value="sync">Sync</option><option value="metadata">Metadata</option><option value="download">Download</option><option value="video">Video</option></select><button className="button secondary">Filter</button></form><div className="card" style={{ padding: 0 }}>{logs.length ? logs.map((log) => <div className="log" key={log.id}><span className="muted">{log.createdAt.toLocaleString()}</span><span className={`badge ${log.level === "error" ? "failed" : ""}`}>{log.category}</span><span>{log.message}</span></div>) : <div className="empty"><h2>No log entries</h2><p>Source, sync, and download activity will appear here.</p></div>}</div></>;
}
