-- AlterTable
ALTER TABLE "Source" ADD COLUMN "filenameTemplate" TEXT;
ALTER TABLE "Source" ADD COLUMN "namingScheme" TEXT;

-- AlterTable
ALTER TABLE "SourceVideo" ADD COLUMN "episodeNumber" INTEGER;
ALTER TABLE "SourceVideo" ADD COLUMN "seasonNumber" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "mediaBaseDirectory" TEXT NOT NULL,
    "tunarrUrl" TEXT NOT NULL DEFAULT 'http://127.0.0.1:8000',
    "cacheMaxMegabytes" INTEGER NOT NULL DEFAULT 20480,
    "cacheMaxAgeDays" INTEGER NOT NULL DEFAULT 30,
    "logRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "defaultVideoQuality" TEXT NOT NULL DEFAULT 'best',
    "jobsPaused" BOOLEAN NOT NULL DEFAULT false,
    "ytdlpCookiesPath" TEXT,
    "defaultNamingScheme" TEXT NOT NULL DEFAULT 'id',
    "defaultFilenameTemplate" TEXT NOT NULL DEFAULT '{title}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSettings" ("cacheMaxAgeDays", "cacheMaxMegabytes", "createdAt", "defaultVideoQuality", "id", "jobsPaused", "logRetentionDays", "mediaBaseDirectory", "tunarrUrl", "updatedAt", "ytdlpCookiesPath") SELECT "cacheMaxAgeDays", "cacheMaxMegabytes", "createdAt", "defaultVideoQuality", "id", "jobsPaused", "logRetentionDays", "mediaBaseDirectory", "tunarrUrl", "updatedAt", "ytdlpCookiesPath" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
