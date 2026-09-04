import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SourceActions } from "@/components/source-actions";
import { VideoSelectionTable } from "@/components/video-selection-table";
import { TunarrChannelForm } from "@/components/tunarr-channel-form";
import { SourceSettings } from "@/components/source-settings";
import { AddCollectionVideos } from "@/components/add-collection-videos";
import { db } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = await db.source.findUnique({ where: { id }, include: { videos: { orderBy: [{ playlistIndex: "asc" }, { createdAt: "asc" }], include: { video: true } } } });
  if (!source) notFound();
  const rows = source.videos.map((membership) => ({ membershipId: membership.id, videoId: membership.videoId, youtubeId: membership.video.youtubeId, title: membership.video.title, uploader: membership.video.uploader, durationSeconds: membership.video.durationSeconds, playlistIndex: membership.playlistIndex, metadataStatus: membership.video.metadataStatus, availability: membership.video.availability, availabilityReason: membership.video.availabilityReason, membershipStatus: membership.membershipStatus, downloadStatus: membership.downloadStatus }));
  const downloadedCount = source.videos.filter((membership) => membership.membershipStatus === "present" && membership.downloadStatus === "complete" && membership.localPath).length;
  const lastPublishedLabel = source.tunarrLastPublishedAt
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(source.tunarrLastPublishedAt) + " UTC"
    : null;
  const isCollection = source.sourceType === "collection";
  return <><PageHeader eyebrow={isCollection ? "Curated YouTube collection" : `YouTube ${source.sourceType} · ${source.feedType}`} title={source.name} /><SourceActions sourceId={source.id} canSync={!isCollection} /><div className="meta" style={{ marginBottom: 20 }}><span>{source.uploaderName ?? "Multiple uploaders"}</span><span>·</span><span>{rows.length} videos</span><span>·</span><span className="code">{source.mediaDirectory}</span></div>{isCollection ? <AddCollectionVideos sourceId={source.id} linked={Boolean(source.tunarrChannelId)} /> : null}<SourceSettings sourceId={source.id} initialMode={source.playbackMode} initialVideoQuality={source.videoQuality} initialSyncEnabled={source.syncEnabled} initialInterval={source.syncIntervalMinutes} supportsSync={!isCollection}/><TunarrChannelForm sourceId={source.id} sourceName={source.name} downloadedCount={downloadedCount} playbackMode={source.playbackMode} channelId={source.tunarrChannelId} channelNumber={source.tunarrChannelNumber} initialChannelName={source.tunarrChannelName} initialOrder={source.tunarrProgrammingOrder} lastPublishedLabel={lastPublishedLabel} /><VideoSelectionTable sourceId={source.id} rows={rows} /></>;
}
