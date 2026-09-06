"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Trash2 } from "lucide-react";

export function LogsToolbar({ retentionDays }: { retentionDays: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"purge" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "purge" | "clear") {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch("/api/logs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Log purge failed");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Log purge failed");
    } finally {
      setBusy(null);
    }
  }

  return <>
    <span className="muted">Retaining {retentionDays} day{retentionDays === 1 ? "" : "s"}</span>
    <button className="button secondary" disabled={Boolean(busy)} onClick={() => run("purge")}>{busy === "purge" ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />} Purge old entries</button>
    <button className="button secondary" disabled={Boolean(busy)} onClick={() => window.confirm("Delete every log entry?") && run("clear")}>{busy === "clear" ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />} Clear all</button>
    {error ? <span className="error">{error}</span> : null}
  </>;
}
