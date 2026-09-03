PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'playlist',
    "youtubeId" TEXT NOT NULL,
    "uploaderName" TEXT,
    "thumbnailUrl" TEXT,
    "thumbnailPath" TEXT,
    "playbackMode" TEXT NOT NULL DEFAULT 'download',
    "feedType" TEXT NOT NULL DEFAULT 'playlist',
    "historyLimit" INTEGER,
    "directoryName" TEXT NOT NULL,
    "mediaDirectory" TEXT NOT NULL,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 360,
    "nextSyncAt" DATETIME,
    "lastSyncedAt" DATETIME,
    "lastSyncStatus" TEXT,
    "tunarrMediaSourceId" TEXT,
    "tunarrLibraryId" TEXT,
    "tunarrChannelId" TEXT,
    "tunarrChannelNumber" INTEGER,
    "tunarrLastPublishedAt" DATETIME,
    "tunarrChannelName" TEXT,
    "tunarrRequestedChannelNumber" INTEGER,
    "tunarrProgrammingOrder" TEXT NOT NULL DEFAULT 'playlist',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Source" ("id","name","url","sourceType","youtubeId","uploaderName","thumbnailUrl","playbackMode","directoryName","mediaDirectory","syncEnabled","syncIntervalMinutes","lastSyncedAt","lastSyncStatus","tunarrMediaSourceId","tunarrLibraryId","tunarrChannelId","tunarrChannelNumber","tunarrLastPublishedAt","createdAt","updatedAt") SELECT "id","name","url","sourceType","youtubeId","uploaderName","thumbnailUrl","playbackMode","directoryName","mediaDirectory","syncEnabled","syncIntervalMinutes","lastSyncedAt","lastSyncStatus","tunarrMediaSourceId","tunarrLibraryId","tunarrChannelId","tunarrChannelNumber","tunarrLastPublishedAt","createdAt","updatedAt" FROM "Source";
DROP TABLE "Source";
ALTER TABLE "new_Source" RENAME TO "Source";
CREATE UNIQUE INDEX "Source_sourceType_youtubeId_feedType_key" ON "Source"("sourceType", "youtubeId", "feedType");
CREATE UNIQUE INDEX "Source_directoryName_key" ON "Source"("directoryName");
CREATE INDEX "Source_updatedAt_idx" ON "Source"("updatedAt");

ALTER TABLE "Video" ADD COLUMN "thumbnailPath" TEXT;
ALTER TABLE "SourceVideo" ADD COLUMN "retentionOrigin" TEXT NOT NULL DEFAULT 'none';
UPDATE "SourceVideo" SET "retentionOrigin" = 'permanent' WHERE "downloadStatus" = 'complete' AND "localPath" IS NOT NULL;
ALTER TABLE "ImportDraft" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'playlist';
ALTER TABLE "ImportDraft" ADD COLUMN "feedType" TEXT NOT NULL DEFAULT 'playlist';
ALTER TABLE "ImportDraft" ADD COLUMN "historyLimit" INTEGER;
ALTER TABLE "AppSettings" ADD COLUMN "cacheMaxMegabytes" INTEGER NOT NULL DEFAULT 20480;
ALTER TABLE "AppSettings" ADD COLUMN "cacheMaxAgeDays" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "CacheAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoId" TEXT NOT NULL,
    "localPath" TEXT,
    "fileSize" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'not_cached',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "cachedAt" DATETIME,
    "lastAccessedAt" DATETIME,
    "activeReaders" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CacheAsset_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CacheAsset_videoId_key" ON "CacheAsset"("videoId");
CREATE INDEX "CacheAsset_status_lastAccessedAt_idx" ON "CacheAsset"("status", "lastAccessedAt");
CREATE INDEX "CacheAsset_pinned_status_idx" ON "CacheAsset"("pinned", "status");

CREATE TABLE "TunarrPathMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ytarrPrefix" TEXT NOT NULL,
    "tunarrPrefix" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "TunarrPathMapping_ytarrPrefix_key" ON "TunarrPathMapping"("ytarrPrefix");
CREATE INDEX "TunarrPathMapping_position_idx" ON "TunarrPathMapping"("position");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
