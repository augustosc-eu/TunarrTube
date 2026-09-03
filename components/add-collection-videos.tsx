"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus } from "lucide-react";

async function responseData(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body.data as { addedCount: number; duplicateCount: number };
}

export function AddCollectionVideos({ sourceId, linked }: { sourceId: string; linked: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const urls = value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
    if (!urls.length) return;
    setBusy(true); setFailed(false); setMessage("Reading video metadata…");
    try {
      const result = await responseData(await fetch(`/api/sources/${sourceId}/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls })
      }));
      setValue("");
      const duplicates = result.duplicateCount ? ` ${result.duplicateCount} already in this collection.` : "";
      setMessage(`Added ${result.addedCount} video${result.addedCount === 1 ? "" : "s"}.${duplicates}${linked && result.addedCount ? " Tunarr will refresh after media preparation." : ""}`);
      router.refresh();
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : "Could not add videos");
    } finally { setBusy(false); }
  }

  return <section className="card integration-card">
    <h2>Add individual videos</h2>
    <p>Paste one or more public YouTube video URLs, separated by spaces or new lines. They are appended in this order.</p>
    <form onSubmit={submit}>
      <div className="field"><label htmlFor="collection-video-urls">YouTube video URLs</label><textarea className="input" id="collection-video-urls" rows={4} required placeholder="https://youtu.be/rtX9Fof1muY" value={value} onChange={(event) => setValue(event.target.value)} /></div>
      <button className="button" disabled={busy || !value.trim()}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />} Add videos</button>
    </form>
    {message ? <p className={failed ? "error" : "success"} role={failed ? "alert" : "status"}>{message}</p> : null}
  </section>;
}
