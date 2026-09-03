import { AddSourceForm } from "@/components/add-source-form";
import { PageHeader } from "@/components/page-header";

export default function NewSourcePage() {
  return <><PageHeader eyebrow="YouTube ingestion" title="Add YouTube Source" /><p>Analyze a public playlist or channel and choose how YTarr should retain its media.</p><AddSourceForm /></>;
}
