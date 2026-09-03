import { db } from "@/lib/db/client";
import { writeLog } from "@/lib/logging/service";
import { fetchVideoMetadata } from "@/lib/youtube/ytdlp";

export async function enrichVideo(videoId: string) {
  const video = await db.video.findUnique({ where: { id: videoId } });
  if (!video) return;
  try {
    const metadata = await fetchVideoMetadata(video.youtubeUrl);
    await db.video.update({
      where: { id: videoId },
      data: {
        title: metadata.title,
        description: metadata.description,
        uploader: metadata.uploader,
        durationSeconds: metadata.durationSeconds,
        uploadDate: metadata.uploadDate,
        thumbnailUrl: metadata.thumbnailUrl,
        youtubeUrl: metadata.youtubeUrl,
        availability: metadata.availability === "unknown" ? "available" : metadata.availability,
        metadataStatus: "complete"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/private|unavailable|deleted|removed/i.test(message)) {
      await db.video.update({ where: { id: videoId }, data: { availability: "unavailable", metadataStatus: "failed" } });
      await writeLog({ level: "warn", category: "video", videoId, message: `Video ${video.youtubeId} is unavailable.` });
      return;
    }
    await db.video.update({ where: { id: videoId }, data: { metadataStatus: "failed" } });
    throw error;
  }
}
