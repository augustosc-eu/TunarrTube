/*
  Warnings:

  - A unique constraint covering the columns `[activeKey]` on the table `Job` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Job" ADD COLUMN "activeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Job_activeKey_key" ON "Job"("activeKey");
