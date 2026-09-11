import path from "node:path";
import { defineConfig } from "@prisma/config";

// Prisma CLI (migrate/studio) config. This mirrors lib/db/client.ts's default so
// `prisma migrate dev`/`migrate deploy` work with the same DATABASE_URL convention
// the app uses at runtime -- see docs/ARCHITECTURE.md.
if (!process.env.DATABASE_URL && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(path.join(process.cwd(), ".env"));
  } catch {
    // no .env file -- fall back to the default below, same as lib/db/client.ts
  }
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations")
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./ytarr.db"
  }
});
