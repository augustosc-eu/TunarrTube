import { PageHeader } from "@/components/page-header";
import { JobQueue } from "@/components/job-queue";
import { serialize } from "@/lib/api";
import { listJobs } from "@/lib/jobs/service";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const initial = serialize(await listJobs()) as unknown as Parameters<typeof JobQueue>[0]["initial"];
  return <><PageHeader eyebrow="Background work" title="Queue" /><JobQueue initial={initial} /></>;
}
