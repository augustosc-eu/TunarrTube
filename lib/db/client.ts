import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { DATABASE_FILENAME, migrateLegacyDatabase } from "@/scripts/migrate-legacy-database.mjs";

process.env.DATABASE_URL ??= `file:./${DATABASE_FILENAME}`;

// Prisma 7 requires a driver adapter, and the SQLite one resolves a relative path against the working
// directory. Keep resolving it against prisma/ instead (where Prisma 6 did, and where
// scripts/prepare-dev.mjs creates the file) so an existing dev database is still the one opened.
function resolveSqlitePath(url: string): string {
  if (!url.startsWith("file:")) return url;
  const filePath = url.slice(5);
  return `file:${path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), "prisma", filePath)}`;
}

// npm start/dev and the Docker image already rename a pre-rename ytarr.db before migrating, but a custom
// startup that launches the server directly would otherwise open (and create) an empty database under the
// new name. Never during `next build`, which can run while another server still has the database open.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  migrateLegacyDatabase(resolveSqlitePath(process.env.DATABASE_URL).replace(/^file:/, ""));
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: resolveSqlitePath(process.env.DATABASE_URL) }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
