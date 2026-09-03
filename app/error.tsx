"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="empty"><h1>YTarr hit an error</h1><p>{error.message}</p><button className="button" onClick={reset}>Try again</button></div>;
}
