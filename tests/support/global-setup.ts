import type { TestProject } from "vitest/node";
import { createTestDatabase } from "./test-database";

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

// Runs once per `vitest` run, before any test file. Each run gets its own freshly migrated database
// (tests/support/test-database.ts), handed to every test file through provide/inject (tests/support/
// setup.ts), and removed again when the run ends.
export default async function setup(project: TestProject) {
  const database = await createTestDatabase();
  project.provide("databaseUrl", database.url);
  return () => database.dispose();
}
