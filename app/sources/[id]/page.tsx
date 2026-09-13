import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SourceActions } from "@/components/source-actions";
import { VideoSelectionTable } from "@/components/video-selection-table";
import { TunarrChannelForm } from "@/components/tunarr-channel-form";
import { SourceSettings } from "@/components/source-settings";
import { AddCollectionVideos } from "@/components/add-collection-videos";
import { db } from "@/lib/db/client";
import { sourceVideosQuerySchema } from "@/lib/validation";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function SourcePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const rawQuery = await searchParams;
  const query = sourceVideosQuerySchema.parse(Object.fromEntries(Object.entries(rawQuery).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const where: Prisma.SourceVideoWhereInput = {
    sourceId: id,
    ...(query.query ? { OR: [
      { video: { title: { contains: query.query } } },
      { video: { uploader: { contains: query.query } } },
      { video: { youtubeId: { contains: query.query } } }
    ] } : {})
  };
  const orderBy: Prisma.SourceVideoOrderByWithRelationInput[] = query.sort === "title"
    ? [{ video: { title: query.order } }, { createdAt: "asc" }]
    : query.sort === "duration"
      ? [{ video: { durationSeconds: query.order } }, { createdAt: "asc" }]
      : query.sort === "status"
        ? [{ downloadStatus: query.order }, { createdAt: "asc" }]
        : [{ playlistIndex: query.order }, { createdAt: "asc" }];
  const [source, memberships, totalCount, filteredCount, downloadedCount, downloadableCount] = await Promise.all([
    db.source.findUnique({
      where: { id },
      select: {
        id: true, name: true, sourceType: true, feedType: true, uploaderName: true, mediaDirectory: true,
        playbackMode: true, videoQuality: true, syncEnabled: true, syncIntervalMinutes: true,
        namingScheme: true, filenameTemplate: true, tunarrChannelId: true, tunarrChannelNumber: true,
        tunarrChannelName: true, tunarrProgrammingOrder: true, tunarrLastPublishedAt: true,
        aiProgrammingInstructions: true, aiProvider: true, aiScheduleStyle: true
      }
    }),
    db.sourceVideo.findMany({
      where, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize,
      select: {
        id: true, videoId: true, playlistIndex: true, membershipStatus: true, downloadStatus: true,
        video: { select: { youtubeId: true, title: true, uploader: true, durationSeconds: true, metadataStatus: true, availability: true, availabilityReason: true } }
      }
    }),
    db.sourceVideo.count({ where: { sourceId: id } }),
    db.sourceVideo.count({ where }),
    db.sourceVideo.count({ where: { sourceId: id, membershipStatus: "present", downloadStatus: "complete", localPath: { not: null } } }),
    db.sourceVideo.count({ where: { ...where, membershipStatus: "present", downloadStatus: { not: "complete" } } })
  ]);
  if (!source) notFound();
  const rows = memberships.map((membership) => ({ membershipId: membership.id, videoId: membership.videoId, youtubeId: membership.video.youtubeId, title: membership.video.title, uploader: membership.video.uploader, durationSeconds: membership.video.durationSeconds, playlistIndex: membership.playlistIndex, metadataStatus: membership.video.metadataStatus, availability: membership.video.availability, availabilityReason: membership.video.availabilityReason, membershipStatus: membership.membershipStatus, downloadStatus: membership.downloadStatus }));
  const lastPublishedLabel = source.tunarrLastPublishedAt
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(source.tunarrLastPublishedAt) + " UTC"
    : null;
  const isCollection = source.sourceType === "collection";
  return <><PageHeader eyebrow={isCollection ? "Curated YouTube collection" : `YouTube ${source.sourceType} · ${source.feedType}`} title={source.name} /><SourceActions sourceId={source.id} canSync={!isCollection} /><div className="meta" style={{ marginBottom: 20 }}><span>{source.uploaderName ?? "Multiple uploaders"}</span><span>·</span><span>{totalCount} videos</span><span>·</span><span className="code">{source.mediaDirectory}</span></div>{isCollection ? <AddCollectionVideos sourceId={source.id} linked={Boolean(source.tunarrChannelId)} /> : null}<SourceSettings sourceId={source.id} initialMode={source.playbackMode} initialVideoQuality={source.videoQuality} initialSyncEnabled={source.syncEnabled} initialInterval={source.syncIntervalMinutes} supportsSync={!isCollection} initialNamingScheme={source.namingScheme} initialFilenameTemplate={source.filenameTemplate}/><TunarrChannelForm sourceId={source.id} sourceName={source.name} downloadedCount={downloadedCount} playbackMode={source.playbackMode} channelId={source.tunarrChannelId} channelNumber={source.tunarrChannelNumber} initialChannelName={source.tunarrChannelName} initialOrder={source.tunarrProgrammingOrder} initialAiInstructions={source.aiProgrammingInstructions} initialAiProvider={source.aiProvider} initialAiScheduleStyle={source.aiScheduleStyle} lastPublishedLabel={lastPublishedLabel} /><VideoSelectionTable sourceId={source.id} rows={rows} filters={{ query: query.query, sort: query.sort, order: query.order }} pagination={{ page: query.page, pageSize: query.pageSize, total: filteredCount, totalPages: Math.max(1, Math.ceil(filteredCount / query.pageSize)), sourceTotal: totalCount }} downloadableCount={downloadableCount} /></>;
}
