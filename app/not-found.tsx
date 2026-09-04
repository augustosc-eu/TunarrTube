import Link from "next/link";
import { PageHeader } from "@/components/page-header";

export default function NotFound() {
  return <>
    <PageHeader eyebrow="404" title="Not found" />
    <div className="empty"><p>The requested YTarr resource does not exist.</p><Link className="button" href="/">Back to dashboard</Link></div>
  </>;
}
