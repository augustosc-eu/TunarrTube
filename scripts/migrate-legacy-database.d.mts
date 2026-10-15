// Types for migrate-legacy-database.mjs, which TypeScript callers (lib/db/client.ts, prisma.config.ts,
// tests) import directly. The script itself stays plain .mjs so scripts/prepare-dev.mjs and the
// Dockerfile's CMD can run it with bare Node.
export declare const DATABASE_FILENAME: string;
export declare function resolveDatabasePath(url: string, projectRoot?: string): string | null;
export declare function migrateLegacyDatabase(databasePath: string | null | undefined): boolean;
