"use client";

import { PageHeader } from "@/components/page-header";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <>
    <PageHeader eyebrow="Error" title="TunarrTube hit an error" />
    <div className="empty"><p>{error.message}</p><button className="button" onClick={reset}>Try again</button></div>
  </>;
}
