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
    "ytdlpCookiesPath" TEXT,
    "metadataMusicbrainzEnabled" BOOLEAN NOT NULL DEFAULT true,
    "metadataItunesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "metadataAutoApplyThreshold" INTEGER NOT NULL DEFAULT 80,
    "aiProvider" TEXT NOT NULL DEFAULT 'auto',
    "aiClaudeCodeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiClaudeCodePath" TEXT,
    "aiClaudeCodeTimeoutSeconds" INTEGER NOT NULL DEFAULT 120,
    "defaultNamingScheme" TEXT NOT NULL DEFAULT 'id',
    "defaultFilenameTemplate" TEXT NOT NULL DEFAULT '{title}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSettings" ("aiProvider", "cacheMaxAgeDays", "cacheMaxMegabytes", "createdAt", "defaultFilenameTemplate", "defaultNamingScheme", "defaultVideoQuality", "id", "jobsPaused", "logRetentionDays", "mediaBaseDirectory", "metadataAutoApplyThreshold", "metadataItunesEnabled", "metadataMusicbrainzEnabled", "musicbrainzContactEmail", "tunarrUrl", "updatedAt", "ytdlpCookiesPath") SELECT "aiProvider", "cacheMaxAgeDays", "cacheMaxMegabytes", "createdAt", "defaultFilenameTemplate", "defaultNamingScheme", "defaultVideoQuality", "id", "jobsPaused", "logRetentionDays", "mediaBaseDirectory", "metadataAutoApplyThreshold", "metadataItunesEnabled", "metadataMusicbrainzEnabled", "musicbrainzContactEmail", "tunarrUrl", "updatedAt", "ytdlpCookiesPath" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
