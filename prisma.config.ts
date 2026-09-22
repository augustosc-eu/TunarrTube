import path from "node:path";
import { defineConfig } from "@prisma/config";

// Prisma CLI (migrate/studio) config. Prisma 7 no longer reads the connection URL from schema.prisma,
// so this supplies the same DATABASE_URL convention the app uses at runtime (lib/db/client.ts) --
// see docs/ARCHITECTURE.md.
if (!process.env.DATABASE_URL && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(path.join(process.cwd(), ".env"));
  } catch {
    // no .env file -- fall back to the default below, same as lib/db/client.ts
  }
}

// Relative `file:` URLs resolve against prisma/ (where Prisma 6 resolved them, and where
// scripts/prepare-dev.mjs creates the file), not the working directory.
function resolveDatabaseUrl(url: string): string {
  if (!url.startsWith("file:")) return url;
  const filePath = url.slice(5);
  return `file:${path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), "prisma", filePath)}`;
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations")
  },
  datasource: {
    url: resolveDatabaseUrl(process.env.DATABASE_URL ?? "file:./ytarr.db")
  }
});
