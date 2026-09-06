import path from "node:path";
import { readdir } from "node:fs/promises";
import { AppError } from "@/lib/api";
import { VIDEO_EXTENSIONS } from "@/lib/constants";
import { db } from "@/lib/db/client";
import { ffprobeMediaInfo } from "@/lib/ffmpeg/probe";
import { writeLog } from "@/lib/logging/service";
import { addMediaItemToChannel } from "@/lib/channels/service";

function titleFromFilename(filePath: string) {
  return path.basename(filePath, path.extname(filePath)).replace(/[._]+/g, " ").trim();
}

export async function scanLocalFolder(channelId: string, folderPath: string) {
  if (!path.isAbsolute(folderPath)) throw new AppError("INVALID_FOLDER_PATH", "The folder path must be absolute.", 400);
  const channel = await db.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Channel not found.", 404);

  let entries: string[];
  try {
    entries = await readdir(folderPath);
  } catch {
    throw new AppError("FOLDER_NOT_READABLE", `Could not read folder: ${folderPath}`, 400);
  }

  let added = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (!VIDEO_EXTENSIONS.includes(path.extname(entry).toLowerCase())) continue;
    const fullPath = path.join(folderPath, entry);
    const existing = await db.mediaItem.findFirst({ where: { originLocalPath: fullPath } });
    if (existing) {
      await addMediaItemToChannel(channelId, existing.id);
      skipped++;
      continue;
    }
    let durationSeconds: number | null = null;
    try {
      const info = await ffprobeMediaInfo(fullPath);
      durationSeconds = Math.round(info.durationSeconds);
    } catch {
      // Best-effort: an unreadable/unsupported file still gets added so the user can see and remove it.
    }
    const mediaItem = await db.mediaItem.create({
      data: {
        originType: "local",
        originLocalPath: fullPath,
        title: titleFromFilename(entry),
        durationSeconds,
        metadataStatus: "pending"
      }
    });
    await addMediaItemToChannel(channelId, mediaItem.id);
    added++;
  }

  await writeLog({ category: "ingest", channelId, message: `Scanned ${folderPath}: added ${added}, already tracked ${skipped}.` });
  return { added, skipped };
}
