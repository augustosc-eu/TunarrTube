CREATE TABLE "Source" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "url" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL DEFAULT 'playlist', "youtubeId" TEXT NOT NULL,
  "uploaderName" TEXT, "thumbnailUrl" TEXT, "playbackMode" TEXT NOT NULL DEFAULT 'download',
  "directoryName" TEXT NOT NULL, "mediaDirectory" TEXT NOT NULL,
  "syncEnabled" BOOLEAN NOT NULL DEFAULT false, "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 360,
  "lastSyncedAt" DATETIME, "lastSyncStatus" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "Video" (
  "id" TEXT NOT NULL PRIMARY KEY, "youtubeId" TEXT NOT NULL, "title" TEXT NOT NULL,
  "description" TEXT, "uploader" TEXT, "durationSeconds" INTEGER, "uploadDate" DATETIME,
  "thumbnailUrl" TEXT, "youtubeUrl" TEXT NOT NULL, "availability" TEXT NOT NULL DEFAULT 'unknown',
  "metadataStatus" TEXT NOT NULL DEFAULT 'pending', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "SourceVideo" (
  "id" TEXT NOT NULL PRIMARY KEY, "sourceId" TEXT NOT NULL, "videoId" TEXT NOT NULL,
  "playlistIndex" INTEGER, "membershipStatus" TEXT NOT NULL DEFAULT 'present',
  "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "localPath" TEXT,
  "downloadStatus" TEXT NOT NULL DEFAULT 'not_downloaded', "fileSize" BIGINT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SourceVideo_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SourceVideo_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "ImportDraft" (
  "id" TEXT NOT NULL PRIMARY KEY, "url" TEXT NOT NULL, "youtubeId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "uploaderName" TEXT, "thumbnailUrl" TEXT, "entriesJson" TEXT NOT NULL, "videoCount" INTEGER NOT NULL,
  "expiresAt" DATETIME NOT NULL, "consumedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "Job" (
  "id" TEXT NOT NULL PRIMARY KEY, "type" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued',
  "sourceId" TEXT, "videoId" TEXT, "payloadJson" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3, "error" TEXT, "runAfter" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "startedAt" DATETIME, "finishedAt" DATETIME,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Job_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Job_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "AppSettings" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1, "mediaBaseDirectory" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "LogEntry" (
  "id" TEXT NOT NULL PRIMARY KEY, "level" TEXT NOT NULL DEFAULT 'info', "category" TEXT NOT NULL,
  "message" TEXT NOT NULL, "details" TEXT, "sourceId" TEXT, "videoId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LogEntry_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LogEntry_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Source_updatedAt_idx" ON "Source"("updatedAt");
CREATE UNIQUE INDEX "Source_sourceType_youtubeId_key" ON "Source"("sourceType", "youtubeId");
CREATE UNIQUE INDEX "Source_directoryName_key" ON "Source"("directoryName");
CREATE UNIQUE INDEX "Video_youtubeId_key" ON "Video"("youtubeId");
CREATE INDEX "Video_createdAt_idx" ON "Video"("createdAt");
CREATE INDEX "SourceVideo_sourceId_playlistIndex_idx" ON "SourceVideo"("sourceId", "playlistIndex");
CREATE INDEX "SourceVideo_downloadStatus_idx" ON "SourceVideo"("downloadStatus");
CREATE UNIQUE INDEX "SourceVideo_sourceId_videoId_key" ON "SourceVideo"("sourceId", "videoId");
CREATE INDEX "ImportDraft_expiresAt_idx" ON "ImportDraft"("expiresAt");
CREATE INDEX "Job_status_runAfter_createdAt_idx" ON "Job"("status", "runAfter", "createdAt");
CREATE INDEX "Job_sourceId_type_status_idx" ON "Job"("sourceId", "type", "status");
CREATE INDEX "Job_videoId_type_status_idx" ON "Job"("videoId", "type", "status");
CREATE INDEX "LogEntry_createdAt_idx" ON "LogEntry"("createdAt");
CREATE INDEX "LogEntry_category_createdAt_idx" ON "LogEntry"("category", "createdAt");
