import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL ??= "file:./ytarr.db";

// Prisma 7 requires a driver adapter, and the SQLite one resolves a relative path against the working
// directory. Keep resolving it against prisma/ instead (where Prisma 6 did, and where
// scripts/prepare-dev.mjs creates the file) so an existing dev database is still the one opened.
function resolveSqlitePath(url: string): string {
  if (!url.startsWith("file:")) return url;
  const filePath = url.slice(5);
  return `file:${path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), "prisma", filePath)}`;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: resolveSqlitePath(process.env.DATABASE_URL) }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
