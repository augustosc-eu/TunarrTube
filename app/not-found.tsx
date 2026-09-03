import Link from "next/link";

export default function NotFound() {
  return <div className="empty"><h1>Not found</h1><p>The requested YTarr resource does not exist.</p><Link className="button" href="/">Back to dashboard</Link></div>;
}
