-- Renames TunarrPathMapping's local-path column after the project rename to TunarrTube. Written as a real
-- column rename: Prisma can't detect renames and generated a drop-and-recreate that would have deleted
-- every stored path mapping. SQLite rewrites the unique index's column reference automatically; only the
-- index name needs replacing to match the one Prisma expects.
ALTER TABLE "TunarrPathMapping" RENAME COLUMN "ytarrPrefix" TO "tunarrtubePrefix";
DROP INDEX "TunarrPathMapping_ytarrPrefix_key";
CREATE UNIQUE INDEX "TunarrPathMapping_tunarrtubePrefix_key" ON "TunarrPathMapping"("tunarrtubePrefix");
