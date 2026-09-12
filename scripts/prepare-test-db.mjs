// Tests (tests/*.integration.test.ts and friends) exercise real lib/ services against a real Prisma
// client -- only fetch/child_process are stubbed (see AGENTS.md). Without this, lib/db/client.ts's own
// `process.env.DATABASE_URL ??= "file:./ytarr.db"` fallback points tests at the exact same SQLite file
// `npm run dev` uses, so every fixture a test forgets to clean up after a failed assertion (inline
// cleanup at the end of an `it()` block never runs if an earlier expect() throws) leaks permanently into
// the dev database. Setting DATABASE_URL here, before prepare-dev.mjs's own `??=`-style resolution runs,
// points the whole test run at a dedicated prisma/ytarr.test.db instead -- same schema, thrown away
// data. `??=` still lets an explicit DATABASE_URL from the environment win, same convention as
// prepare-dev.mjs and lib/db/client.ts.
process.env.DATABASE_URL ??= "file:./ytarr.test.db";
await import("./prepare-dev.mjs");
