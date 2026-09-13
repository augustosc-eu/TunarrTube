-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "aiProgrammingInstructions" TEXT;
ALTER TABLE "Channel" ADD COLUMN "aiProgrammingPlanJson" TEXT;
ALTER TABLE "Channel" ADD COLUMN "aiProvider" TEXT;

-- AlterTable
ALTER TABLE "Source" ADD COLUMN "aiProgrammingInstructions" TEXT;
ALTER TABLE "Source" ADD COLUMN "aiProgrammingPlanJson" TEXT;
ALTER TABLE "Source" ADD COLUMN "aiProvider" TEXT;

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
    "musicbrainzContactEmail" TEXT,
    "aiProvider" TEXT NOT NULL DEFAULT 'auto',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSettings" ("cacheMaxAgeDays", "cacheMaxMegabytes", "createdAt", "defaultVideoQuality", "id", "jobsPaused", "logRetentionDays", "mediaBaseDirectory", "musicbrainzContactEmail", "tunarrUrl", "updatedAt") SELECT "cacheMaxAgeDays", "cacheMaxMegabytes", "createdAt", "defaultVideoQuality", "id", "jobsPaused", "logRetentionDays", "mediaBaseDirectory", "musicbrainzContactEmail", "tunarrUrl", "updatedAt" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
