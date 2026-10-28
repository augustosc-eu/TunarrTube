import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const migrationsDirectory = path.resolve(import.meta.dirname, "..", "..", "prisma", "migrations");

export type TestDatabase = { url: string; file: string; dispose: () => Promise<void> };

// A brand-new, fully migrated SQLite file in its own temp directory. Every test run gets one (see
// tests/support/global-setup.ts) and deletes it afterwards, so nothing a run leaves behind -- queued jobs
// from a timed-out test, fixtures whose cleanup never ran -- can reach the next run. A run that is killed
// before teardown only strands a uniquely named temp directory; nothing ever opens it again.
//
// The committed migrations are applied in Prisma's order (folder name) by executing each migration.sql,
// which is what `prisma migrate deploy` runs for SQLite, minus its _prisma_migrations bookkeeping (which
// the app never reads). Going through the CLI instead costs a native schema-engine launch per database.
export async function createTestDatabase(): Promise<TestDatabase> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-test-db-"));
  const file = path.join(directory, "test.db");
  try {
    const migrations = (await readdir(migrationsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const sqlite = new DatabaseSync(file);
    try {
      for (const migration of migrations) {
        sqlite.exec(await readFile(path.join(migrationsDirectory, migration, "migration.sql"), "utf8"));
      }
    } finally {
      sqlite.close();
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return { url: `file:${file}`, file, dispose: () => rm(directory, { recursive: true, force: true }) };
}
