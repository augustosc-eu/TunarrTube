"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ListChecks, LoaderCircle, RefreshCw, RotateCcw, X } from "lucide-react";

type Job = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  runAfter: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  source: { id: string; name: string } | null;
  video: { id: string; title: string; youtubeId: string } | null;
};

type QueueData = { running: Job[]; queued: Job[]; recent: Job[] };

const TYPE_LABELS: Record<string, string> = {
  download: "Download",
  metadata: "Metadata",
  thumbnail: "Thumbnail",
  sync: "Sync",
  cache: "Cache",
  retag: "Metadata repair",
  tunarr_publish: "Tunarr publish",
  tunarr_refresh: "Tunarr refresh"
};

function typeLabel(type: string) {
  return TYPE_LABELS[type] ?? type;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes}m ${seconds}s`;
  return `${hours}h ${minutes % 60}m`;
}

function Target({ job }: { job: Job }) {
  if (job.video) return <><strong>{job.video.title}</strong>{job.source ? <span className="meta">{job.source.name}</span> : null}</>;
  if (job.source) return <strong>{job.source.name}</strong>;
  return <span className="muted">—</span>;
}

function Detail({ job, now }: { job: Job; now: number }) {
  if (job.status === "running") return <span>Running for {formatDuration(now - new Date(job.startedAt ?? job.createdAt).getTime())}</span>;
  if (job.status === "queued") {
    const runAfter = new Date(job.runAfter).getTime();
    if (runAfter > now) return <span className="muted">Retrying in {formatDuration(runAfter - now)}{job.attempts > 0 ? ` (attempt ${job.attempts + 1}/${job.maxAttempts})` : ""}</span>;
    return <span className="muted">Waiting{job.attempts > 0 ? ` (attempt ${job.attempts + 1}/${job.maxAttempts})` : ""}</span>;
  }
  const finishedAt = job.finishedAt ? new Date(job.finishedAt).getTime() : null;
  const startedAt = job.startedAt ? new Date(job.startedAt).getTime() : null;
  const took = finishedAt && startedAt ? ` in ${formatDuration(finishedAt - startedAt)}` : "";
  const ago = finishedAt ? `${formatDuration(now - finishedAt)} ago` : "—";
  if (job.status === "failed") {
    const message = job.error ?? "Failed";
    return <span style={{ color: "var(--error)" }} title={message}>{message.length > 90 ? `${message.slice(0, 90)}…` : message} · {ago}</span>;
  }
  return <span className="muted">{job.status === "complete" ? `Completed${took}` : "Cancelled"} · {ago}</span>;
}

function Actions({ job, busy, onAction }: { job: Job; busy: boolean; onAction: (job: Job, action: "cancel" | "retry") => void }) {
  // Cancel only ever reaches a "queued" job (which also covers one sitting in a retry backoff) -- a
  // "running" job has no interrupt point, see cancelJob() in lib/jobs/service.ts.
  if (job.status === "queued") return <button className="button secondary" disabled={busy} onClick={() => onAction(job, "cancel")} aria-label="Cancel job">{busy ? <LoaderCircle size={14} className="animate-spin" /> : <X size={14} />} Cancel</button>;
  if (job.status === "failed" || job.status === "cancelled") return <button className="button secondary" disabled={busy} onClick={() => onAction(job, "retry")} aria-label="Retry job">{busy ? <LoaderCircle size={14} className="animate-spin" /> : <RotateCcw size={14} />} Retry</button>;
  return <span className="muted">—</span>;
}

function JobRows({ jobs, now, busyId, onAction }: { jobs: Job[]; now: number; busyId: string | null; onAction: (job: Job, action: "cancel" | "retry") => void }) {
  return <>{jobs.map((job) => <tr key={job.id}>
    <td>{typeLabel(job.type)}</td>
    <td className="title-cell">{job.source ? <Link href={`/sources/${job.source.id}`}><Target job={job} /></Link> : <Target job={job} />}</td>
    <td><span className={`badge ${job.status}`}>{job.status}</span></td>
    <td><Detail job={job} now={now} /></td>
    <td><Actions job={job} busy={busyId === job.id} onAction={onAction} /></td>
  </tr>)}</>;
}

function Section({ title, jobs, now, busyId, onAction }: { title: string; jobs: Job[]; now: number; busyId: string | null; onAction: (job: Job, action: "cancel" | "retry") => void }) {
  if (!jobs.length) return null;
  return <><h2>{title} <span className="muted">({jobs.length})</span></h2><div className="table-wrap" style={{ marginBottom: 24 }}><table><thead><tr><th>Job</th><th>Target</th><th>Status</th><th>Detail</th><th>Actions</th></tr></thead><tbody><JobRows jobs={jobs} now={now} busyId={busyId} onAction={onAction} /></tbody></table></div></>;
}

export function JobQueue({ initial }: { initial: QueueData }) {
  const [data, setData] = useState<QueueData>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [stale, setStale] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = async () => {
    try {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      if (!response.ok) throw new Error("refresh failed");
      const body = await response.json();
      if (mounted.current) { setData(body.data); setStale(false); }
    } catch {
      if (mounted.current) setStale(true);
    }
  };

  useEffect(() => {
    mounted.current = true;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(refresh, 3000);
    return () => { mounted.current = false; clearInterval(tick); clearInterval(poll); };
  }, []);

  async function onAction(job: Job, action: "cancel" | "retry") {
    setBusyId(job.id); setError(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? `Could not ${action} job`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not ${action} job`);
    } finally {
      if (mounted.current) setBusyId(null);
    }
  }

  const isEmpty = !data.running.length && !data.queued.length && !data.recent.length;

  return <>
    <div className="toolbar"><span className="muted"><RefreshCw size={13} className="inline-icon" />Auto-refreshing every few seconds{stale ? " · connection lost, retrying…" : ""}</span></div>
    {error ? <div className="error">{error}</div> : null}
    {isEmpty
      ? <div className="empty"><ListChecks size={32} /><h2>No jobs</h2><p>Metadata, download, sync, and other background work will appear here while it runs.</p></div>
      : <>
        <Section title="Running" jobs={data.running} now={now} busyId={busyId} onAction={onAction} />
        <Section title="Queued" jobs={data.queued} now={now} busyId={busyId} onAction={onAction} />
        <Section title="Recent" jobs={data.recent} now={now} busyId={busyId} onAction={onAction} />
      </>}
  </>;
}
