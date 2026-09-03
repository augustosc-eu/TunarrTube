ALTER TABLE "AppSettings" ADD COLUMN "tunarrUrl" TEXT NOT NULL DEFAULT 'http://127.0.0.1:8000';

ALTER TABLE "Source" ADD COLUMN "tunarrMediaSourceId" TEXT;
ALTER TABLE "Source" ADD COLUMN "tunarrLibraryId" TEXT;
ALTER TABLE "Source" ADD COLUMN "tunarrChannelId" TEXT;
ALTER TABLE "Source" ADD COLUMN "tunarrChannelNumber" INTEGER;
ALTER TABLE "Source" ADD COLUMN "tunarrLastPublishedAt" DATETIME;
