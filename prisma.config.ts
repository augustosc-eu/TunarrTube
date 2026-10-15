import path from "node:path";
import { defineConfig } from "@prisma/config";
import { DATABASE_FILENAME, migrateLegacyDatabase } from "./scripts/migrate-legacy-database.mjs";

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

const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL ?? `file:./${DATABASE_FILENAME}`);

// Any startup that runs `prisma migrate deploy` itself (rather than npm start or the Docker image, which
// already do this) must still move a pre-rename ytarr.db first -- otherwise migrate creates an empty
// database under the new name. Only for `migrate deploy`, the startup command: other Prisma commands
// (generate during builds, migrate diff/status) can run while a server still has the database open.
const cliArgs = process.argv.slice(2);
if (cliArgs.includes("migrate") && cliArgs.includes("deploy") && databaseUrl.startsWith("file:")) {
  migrateLegacyDatabase(databaseUrl.slice(5));
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations")
  },
  datasource: {
    url: databaseUrl
  }
});
