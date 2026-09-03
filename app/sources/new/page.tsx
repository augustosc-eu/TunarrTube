import { AddSourceForm } from "@/components/add-source-form";
import { PageHeader } from "@/components/page-header";

export default function NewSourcePage() {
  return <><PageHeader eyebrow="YouTube ingestion" title="Add YouTube Source" /><p>Analyze a public video, playlist, or channel and choose how YTarr should retain its media. An individual video starts a curated collection you can keep adding to.</p><AddSourceForm /></>;
}
