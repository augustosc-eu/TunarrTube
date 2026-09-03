import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const prismaBin = path.join(projectRoot, "node_modules", ".bin", "prisma");
if (existsSync(path.join(projectRoot, ".env")) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(path.join(projectRoot, ".env"));
}
const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL || "file:./ytarr.db" };
if (env.DATABASE_URL.startsWith("file:")) {
  const configuredPath = env.DATABASE_URL.slice(5);
  const databasePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(projectRoot, "prisma", configuredPath);
  mkdirSync(path.dirname(databasePath), { recursive: true });
  if (!existsSync(databasePath)) closeSync(openSync(databasePath, "a"));
}

for (const args of [["generate"], ["migrate", "deploy"]]) {
  const result = spawnSync(prismaBin, args, { cwd: projectRoot, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
