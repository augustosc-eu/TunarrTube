import { PageHeader } from "@/components/page-header";
import { CacheDashboard } from "@/components/cache-dashboard";
import { cacheDashboard } from "@/lib/cache/service";
import { serialize } from "@/lib/api";

export const dynamic = "force-dynamic";
export default async function CachePage() {
  return <><PageHeader eyebrow="Playback storage" title="Cache" /><CacheDashboard initial={serialize(await cacheDashboard()) as unknown as Parameters<typeof CacheDashboard>[0]["initial"]} /></>;
}
