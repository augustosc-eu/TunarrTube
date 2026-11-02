-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "setupCompletedAt" DATETIME;

-- Installs that already have settings were set up before the wizard existed: don't send them through it.
UPDATE "AppSettings" SET "setupCompletedAt" = CAST(strftime('%s', 'now') AS INTEGER) * 1000;
