-- CreateTable
CREATE TABLE "SiteSetting" (
    "site" TEXT NOT NULL PRIMARY KEY,
    "cookiesPath" TEXT,
    "sleepRequestsSeconds" INTEGER,
    "updatedAt" DATETIME NOT NULL
);
