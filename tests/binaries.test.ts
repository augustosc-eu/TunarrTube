import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { updateBinary } from "@/lib/system/binaries";

const cleanup: string[] = [];

afterEach(async () => {
  delete process.env.TUNARRTUBE_YTDLP_PATH;
  delete process.env.YTARR_YTDLP_PATH;
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fakeYtDlp(root: string, script: string) {
  const binary = path.join(root, "yt-dlp");
  await writeFile(binary, `#!/usr/bin/env node\n${script}\n`);
  await chmod(binary, 0o755);
  process.env.TUNARRTUBE_YTDLP_PATH = binary;
  return binary;
}

describe("updateBinary", () => {
  it("rejects binaries other than yt-dlp", async () => {
    await expect(updateBinary("ffmpeg")).rejects.toThrow(/self-update/);
  });

  it("reports the self-update result and refreshed version", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-update-test-"));
    cleanup.push(root);
    await fakeYtDlp(root, `
const args = process.argv.slice(2);
if (args[0] === "--update") { process.stdout.write("Updated yt-dlp to stable@2099.01.01\\n"); process.exit(0); }
if (args[0] === "--version") { process.stdout.write("2099.01.01\\n"); process.exit(0); }
process.exit(1);
`);

    const result = await updateBinary("yt-dlp");
    expect(result).toMatchObject({ name: "yt-dlp", message: "Updated yt-dlp to stable@2099.01.01", version: "2099.01.01" });
  });

  it("surfaces a package-manager refusal as a failure", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ytarr-update-test-"));
    cleanup.push(root);
    await fakeYtDlp(root, `
const args = process.argv.slice(2);
if (args[0] === "--update") { process.stderr.write("ERROR: use brew upgrade yt-dlp instead\\n"); process.exit(1); }
process.exit(1);
`);

    await expect(updateBinary("yt-dlp")).rejects.toThrow(/brew upgrade yt-dlp/);
  });
});
