"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ListChecks, LoaderCircle, Pause, Play, RefreshCw, RotateCcw, Square, X } from "lucide-react";
import { BulkBar } from "@/components/bulk-bar";

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
  stoppable?: boolean;
  source: { id: string; name: string } | null;
  video: { id: string; title: string; youtubeId: string } | null;
};

type QueueData = { paused: boolean; running: Job[]; queued: Job[]; recent: Job[] };
type JobAction = "cancel" | "retry" | "stop" | "postpone";

// Quick presets for "set aside for later" -- postponeJob() (lib/jobs/service.ts) accepts any minute
// count, this is just what the UI offers.
const POSTPONE_OPTIONS: Array<{ label: string; minutes: number }> = [
  { label: "15 minutes", minutes: 15 },
  { label: "1 hour", minutes: 60 },
  { label: "6 hours", minutes: 360 },
  { label: "Tomorrow", minutes: 60 * 24 },
  { label: "1 week", minutes: 60 * 24 * 7 }
];

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

function Actions({ job, busy, onAction }: { job: Job; busy: boolean; onAction: (job: Job, action: JobAction, postponeMinutes?: number) => void }) {
  // A "running" job can only be interrupted if it's a STOPPABLE_JOB_TYPES kind (see stopJob() in
  // lib/jobs/service.ts) -- a "retag"/"thumbnail" job runs to completion no matter what, so there's
  // nothing to offer there.
  if (job.status === "running") {
    if (!job.stoppable) return <span className="muted">Running — can&apos;t be interrupted</span>;
    return <button className="button secondary" disabled={busy} onClick={() => onAction(job, "stop")}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Square size={14} />} Stop</button>;
  }
  // Cancel and postpone only ever reach a "queued" job (which also covers one sitting in a retry backoff).
  if (job.status === "queued") {
    return <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button className="button secondary" disabled={busy} onClick={() => onAction(job, "cancel")}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <X size={14} />} Cancel</button>
      <select
        className="input" style={{ width: "auto" }} disabled={busy} value="" aria-label="Postpone job"
        onChange={(event) => { const minutes = Number(event.target.value); if (minutes) onAction(job, "postpone", minutes); }}
      >
        <option value="">Postpone…</option>
        {POSTPONE_OPTIONS.map((option) => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}
      </select>
    </div>;
  }
  if (job.status === "failed" || job.status === "cancelled") return <button className="button secondary" disabled={busy} onClick={() => onAction(job, "retry")}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <RotateCcw size={14} />} Retry</button>;
  return <span className="muted">—</span>;
}

function JobRows({ jobs, now, busyId, onAction, selected, onToggle, eligible }: { jobs: Job[]; now: number; busyId: string | null; onAction: (job: Job, action: JobAction, postponeMinutes?: number) => void; selected?: Set<string>; onToggle?: (id: string) => void; eligible?: (job: Job) => boolean }) {
  return <>{jobs.map((job) => <tr key={job.id}>
    {selected ? <td><input type="checkbox" disabled={eligible ? !eligible(job) : false} checked={selected.has(job.id)} onChange={() => onToggle?.(job.id)} aria-label={`Select ${typeLabel(job.type)} job`} /></td> : null}
    <td>{typeLabel(job.type)}</td>
    <td className="title-cell">{job.source ? <Link href={`/sources/${job.source.id}`}><Target job={job} /></Link> : <Target job={job} />}</td>
    <td><span className={`badge ${job.status}`}>{job.status}</span></td>
    <td><Detail job={job} now={now} /></td>
    <td><Actions job={job} busy={busyId === job.id} onAction={onAction} /></td>
  </tr>)}</>;
}

function Section({ title, jobs, now, busyId, onAction, bulk }: {
  title: string; jobs: Job[]; now: number; busyId: string | null; onAction: (job: Job, action: JobAction, postponeMinutes?: number) => void;
  bulk?: { label: string; icon: React.ReactNode; eligible: (job: Job) => boolean; selected: Set<string>; onToggle: (id: string) => void; onSelectAll: (ids: string[]) => void; onClear: () => void; busy: boolean; onRun: () => void };
}) {
  if (!jobs.length) return null;
  const eligibleIds = bulk ? jobs.filter(bulk.eligible).map((job) => job.id) : [];
  return <>
    <h2>{title} <span className="muted">({jobs.length})</span></h2>
    {bulk ? <BulkBar selected={bulk.selected.size} eligible={eligibleIds.length} total={jobs.length} busy={bulk.busy}
      onSelectAll={() => bulk.onSelectAll(eligibleIds)} onClear={bulk.onClear}>
      <button className="button secondary" disabled={bulk.busy} onClick={bulk.onRun}>{bulk.icon} {bulk.label} ({bulk.selected.size})</button>
    </BulkBar> : null}
    <div className="table-wrap" style={{ marginBottom: 24 }}>
      <table>
        <thead><tr>{bulk ? <th /> : null}<th>Job</th><th>Target</th><th>Status</th><th>Detail</th><th>Actions</th></tr></thead>
        <tbody><JobRows jobs={jobs} now={now} busyId={busyId} onAction={onAction} selected={bulk?.selected} onToggle={bulk?.onToggle} eligible={bulk?.eligible} /></tbody>
      </table>
    </div>
  </>;
}

export function JobQueue({ initial }: { initial: QueueData }) {
  const [data, setData] = useState<QueueData>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [stale, setStale] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedSelected, setQueuedSelected] = useState<Set<string>>(new Set());
  const [recentSelected, setRecentSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
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

  async function onAction(job: Job, action: JobAction, postponeMinutes?: number) {
    setBusyId(job.id); setError(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, postponeMinutes }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? `Could not ${action} job`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not ${action} job`);
    } finally {
      if (mounted.current) setBusyId(null);
    }
  }

  function toggleInSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function bulkAction(ids: Set<string>, action: JobAction, clear: () => void) {
    setBulkBusy(true); setError(null);
    try {
      const results = await Promise.allSettled([...ids].map((id) => fetch(`/api/jobs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) })));
      const failures = results.filter((result) => result.status === "rejected");
      clear();
      if (failures.length) setError(`${failures.length} job${failures.length === 1 ? "" : "s"} could not be ${action === "cancel" ? "cancelled" : "retried"}.`);
      await refresh();
    } finally {
      if (mounted.current) setBulkBusy(false);
    }
  }

  async function togglePause() {
    setPauseBusy(true); setError(null);
    try {
      const response = await fetch("/api/jobs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: !data.paused }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Could not update the queue");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the queue");
    } finally {
      if (mounted.current) setPauseBusy(false);
    }
  }

  const isEmpty = !data.running.length && !data.queued.length && !data.recent.length;

  return <>
    <div className="toolbar">
      <span className="muted"><RefreshCw size={13} className="inline-icon" />Auto-refreshing every few seconds{stale ? " · connection lost, retrying…" : ""}</span>
      <span className="spacer" />
      <button className="button secondary" disabled={pauseBusy} onClick={togglePause}>
        {pauseBusy ? <LoaderCircle size={14} className="animate-spin" /> : data.paused ? <Play size={14} /> : <Pause size={14} />}
        {data.paused ? "Resume queue" : "Pause queue"}
      </button>
    </div>
    {data.paused ? <div className="meta" style={{ marginBottom: 16 }}>Queue paused — queued jobs will wait until you resume. Anything already running keeps going unless you stop it.</div> : null}
    {error ? <div className="error">{error}</div> : null}
    {isEmpty
      ? <div className="empty"><ListChecks size={32} /><h2>No jobs</h2><p>Metadata, download, sync, and other background work will appear here while it runs.</p></div>
      : <>
        <Section title="Running" jobs={data.running} now={now} busyId={busyId} onAction={onAction} />
        <Section title="Queued" jobs={data.queued} now={now} busyId={busyId} onAction={onAction} bulk={{
          label: "Cancel selected", icon: <X size={14} />, eligible: () => true,
          selected: queuedSelected, onToggle: (id) => toggleInSet(setQueuedSelected, id),
          onSelectAll: (ids) => setQueuedSelected(new Set(ids)), onClear: () => setQueuedSelected(new Set()),
          busy: bulkBusy, onRun: () => bulkAction(queuedSelected, "cancel", () => setQueuedSelected(new Set()))
        }} />
        <Section title="Recent" jobs={data.recent} now={now} busyId={busyId} onAction={onAction} bulk={{
          label: "Retry selected", icon: <RotateCcw size={14} />, eligible: (job) => job.status === "failed" || job.status === "cancelled",
          selected: recentSelected, onToggle: (id) => toggleInSet(setRecentSelected, id),
          onSelectAll: (ids) => setRecentSelected(new Set(ids)), onClear: () => setRecentSelected(new Set()),
          busy: bulkBusy, onRun: () => bulkAction(recentSelected, "retry", () => setRecentSelected(new Set()))
        }} />
      </>}
  </>;
}
