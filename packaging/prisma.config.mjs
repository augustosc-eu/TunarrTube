// Prisma CLI config for the portable release: scripts/package-release.mjs copies it to app/prisma-cli/,
// next to that directory's own Prisma CLI install, and the launcher passes it with --config. The repo's
// prisma.config.ts can't be used there: it resolves @prisma/config from the app's node_modules, which the
// release doesn't ship with the CLI. The launcher always sets DATABASE_URL and TUNARRTUBE_APP_DIR.
import path from "node:path";
import { defineConfig } from "@prisma/config";

const appDir = process.env.TUNARRTUBE_APP_DIR;
if (!appDir || !process.env.DATABASE_URL) throw new Error("Run TunarrTube through its launcher (TUNARRTUBE_APP_DIR and DATABASE_URL are unset).");

export default defineConfig({
  schema: path.join(appDir, "prisma", "schema.prisma"),
  migrations: { path: path.join(appDir, "prisma", "migrations") },
  datasource: { url: process.env.DATABASE_URL }
});
