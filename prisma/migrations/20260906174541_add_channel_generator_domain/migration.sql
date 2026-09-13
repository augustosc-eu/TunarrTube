-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "musicbrainzContactEmail" TEXT;

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "channelType" TEXT NOT NULL DEFAULT 'music_video',
    "slug" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "storageDirectory" TEXT NOT NULL,
    "logoAssetPath" TEXT,
    "programmingOrder" TEXT NOT NULL DEFAULT 'manual',
    "intakeSourceId" TEXT,
    "tunarrMediaSourceId" TEXT,
    "tunarrLibraryId" TEXT,
    "tunarrChannelId" TEXT,
    "tunarrChannelNumber" INTEGER,
    "tunarrChannelName" TEXT,
    "tunarrRequestedChannelNumber" INTEGER,
    "tunarrLastPublishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Channel_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OverlayTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MediaItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "originType" TEXT NOT NULL,
    "sourceVideoId" TEXT,
    "originLocalPath" TEXT,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "album" TEXT,
    "year" INTEGER,
    "genre" TEXT,
    "releaseDate" DATETIME,
    "durationSeconds" INTEGER,
    "sourceThumbnailUrl" TEXT,
    "sourceThumbnailPath" TEXT,
    "metadataStatus" TEXT NOT NULL DEFAULT 'pending',
    "metadataLookupProvider" TEXT,
    "metadataLookupId" TEXT,
    "metadataLookupJson" TEXT,
    "customFieldsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MediaItem_sourceVideoId_fkey" FOREIGN KEY ("sourceVideoId") REFERENCES "SourceVideo" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChannelItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "mediaItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelItem_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChannelItem_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OverlayTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "channelType" TEXT NOT NULL DEFAULT 'music_video',
    "description" TEXT,
    "htmlTemplate" TEXT NOT NULL,
    "bindingsJson" TEXT NOT NULL,
    "layersJson" TEXT NOT NULL,
    "visualLayoutJson" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RenderedAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaItemId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "outputPath" TEXT,
    "outputDurationSeconds" INTEGER,
    "outputFileSize" BIGINT,
    "overlayPngPaths" TEXT,
    "ffmpegLog" TEXT,
    "error" TEXT,
    "renderedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RenderedAsset_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RenderedAsset_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OverlayTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sourceId" TEXT,
    "videoId" TEXT,
    "channelId" TEXT,
    "mediaItemId" TEXT,
    "payloadJson" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "runAfter" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("attempts", "createdAt", "error", "finishedAt", "id", "maxAttempts", "payloadJson", "runAfter", "sourceId", "startedAt", "status", "type", "updatedAt", "videoId") SELECT "attempts", "createdAt", "error", "finishedAt", "id", "maxAttempts", "payloadJson", "runAfter", "sourceId", "startedAt", "status", "type", "updatedAt", "videoId" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_status_runAfter_createdAt_idx" ON "Job"("status", "runAfter", "createdAt");
CREATE INDEX "Job_sourceId_type_status_idx" ON "Job"("sourceId", "type", "status");
CREATE INDEX "Job_videoId_type_status_idx" ON "Job"("videoId", "type", "status");
CREATE INDEX "Job_channelId_type_status_idx" ON "Job"("channelId", "type", "status");
CREATE INDEX "Job_mediaItemId_type_status_idx" ON "Job"("mediaItemId", "type", "status");
CREATE TABLE "new_LogEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "level" TEXT NOT NULL DEFAULT 'info',
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" TEXT,
    "sourceId" TEXT,
    "videoId" TEXT,
    "channelId" TEXT,
    "mediaItemId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LogEntry_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LogEntry_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LogEntry_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LogEntry_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LogEntry" ("category", "createdAt", "details", "id", "level", "message", "sourceId", "videoId") SELECT "category", "createdAt", "details", "id", "level", "message", "sourceId", "videoId" FROM "LogEntry";
DROP TABLE "LogEntry";
ALTER TABLE "new_LogEntry" RENAME TO "LogEntry";
CREATE INDEX "LogEntry_createdAt_idx" ON "LogEntry"("createdAt");
CREATE INDEX "LogEntry_category_createdAt_idx" ON "LogEntry"("category", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Channel_slug_key" ON "Channel"("slug");

-- CreateIndex
CREATE INDEX "Channel_templateId_idx" ON "Channel"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaItem_sourceVideoId_key" ON "MediaItem"("sourceVideoId");

-- CreateIndex
CREATE INDEX "MediaItem_createdAt_idx" ON "MediaItem"("createdAt");

-- CreateIndex
CREATE INDEX "ChannelItem_channelId_position_idx" ON "ChannelItem"("channelId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelItem_channelId_mediaItemId_key" ON "ChannelItem"("channelId", "mediaItemId");

-- CreateIndex
CREATE UNIQUE INDEX "RenderedAsset_mediaItemId_templateId_key" ON "RenderedAsset"("mediaItemId", "templateId");
