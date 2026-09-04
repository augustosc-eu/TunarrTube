import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const LOG_LIMIT = 500;

// Keep in sync with every category actually written via writeLog(): lib/sources/service.ts,
// lib/downloads/service.ts, lib/metadata/service.ts, lib/cache/service.ts, lib/tunarr/service.ts,
// lib/settings/service.ts, and job types logged from lib/jobs/runner.ts.
const CATEGORIES = [
  { value: "source", label: "Source" },
  { value: "sync", label: "Sync" },
  { value: "metadata", label: "Metadata" },
  { value: "thumbnail", label: "Thumbnail" },
  { value: "download", label: "Download" },
  { value: "video", label: "Video" },
  { value: "retag", label: "Metadata repair" },
  { value: "cache", label: "Cache" },
  { value: "tunarr", label: "Tunarr" },
  { value: "tunarr_publish", label: "Tunarr publish" },
  { value: "tunarr_refresh", label: "Tunarr refresh" },
  { value: "settings", label: "Settings" },
  { value: "yt-dlp", label: "yt-dlp" }
];

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await searchParams;
  const logs = await db.logEntry.findMany({ where: category ? { category } : undefined, orderBy: { createdAt: "desc" }, take: LOG_LIMIT });
  return <><PageHeader eyebrow="Operational history" title="Logs" /><form className="toolbar"><select className="input" style={{ width: 220 }} name="category" defaultValue={category ?? ""}><option value="">All categories</option>{CATEGORIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select><button className="button secondary">Filter</button>{logs.length === LOG_LIMIT ? <span className="muted">Showing the latest {LOG_LIMIT}</span> : null}</form><div className="card" style={{ padding: 0 }}>{logs.length ? logs.map((log) => <div className="log" key={log.id}><span className="muted">{log.createdAt.toLocaleString()}</span><span className={`badge ${log.level === "error" ? "failed" : ""}`}>{log.category}</span><span>{log.message}</span></div>) : <div className="empty"><h2>No log entries</h2><p>Source, sync, and download activity will appear here.</p></div>}</div></>;
}
