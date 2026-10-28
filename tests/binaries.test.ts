import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { updateBinary } from "@/lib/system/binaries";

const cleanup: string[] = [];

afterEach(async () => {
  delete process.env.TUNARRTUBE_YTDLP_PATH;
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

  it("reports a version bump when the self-update actually changes the version", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-update-test-"));
    cleanup.push(root);
    const marker = path.join(root, "updated");
    await fakeYtDlp(root, `
const fs = require("fs");
const args = process.argv.slice(2);
const marker = ${JSON.stringify(marker)};
if (args[0] === "--update") { fs.writeFileSync(marker, "1"); process.stdout.write("Updated yt-dlp to stable@2099.01.01\\n"); process.exit(0); }
if (args[0] === "--version") { process.stdout.write(fs.existsSync(marker) ? "2099.01.01\\n" : "2024.01.01\\n"); process.exit(0); }
process.exit(1);
`);

    const result = await updateBinary("yt-dlp");
    expect(result).toMatchObject({ name: "yt-dlp", message: "Updated yt-dlp from 2024.01.01 to 2099.01.01.", version: "2099.01.01", updated: true });
  });

  it("reports up to date without a version bump when there is nothing to update", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-update-test-"));
    cleanup.push(root);
    await fakeYtDlp(root, `
const args = process.argv.slice(2);
if (args[0] === "--update") { process.stdout.write("yt-dlp is up to date (stable@2024.01.01)\\n"); process.exit(0); }
if (args[0] === "--version") { process.stdout.write("2024.01.01\\n"); process.exit(0); }
process.exit(1);
`);

    const result = await updateBinary("yt-dlp");
    expect(result).toMatchObject({ name: "yt-dlp", message: "yt-dlp is already up to date (2024.01.01).", version: "2024.01.01", updated: false });
  });

  it("surfaces a package-manager refusal as a failure", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-update-test-"));
    cleanup.push(root);
    await fakeYtDlp(root, `
const args = process.argv.slice(2);
if (args[0] === "--version") { process.stdout.write("2024.01.01\\n"); process.exit(0); }
if (args[0] === "--update") { process.stderr.write("ERROR: use brew upgrade yt-dlp instead\\n"); process.exit(1); }
process.exit(1);
`);

    await expect(updateBinary("yt-dlp")).rejects.toThrow(/brew upgrade yt-dlp/);
  });

  // yt-dlp 2026.08.19's real output from a Homebrew install: Homebrew ships the PyPI wheel, so it
  // blames pip, and exits 100.
  const REFUSAL = `
const args = process.argv.slice(2);
if (args[0] === "--version") { process.stdout.write("2026.08.19\\n"); process.exit(0); }
if (args[0] === "--update") {
  process.stdout.write("Current version: stable@2026.08.19 from yt-dlp/yt-dlp\\nLatest version: stable@2026.10.26 from yt-dlp/yt-dlp\\n");
  process.stderr.write("ERROR: You installed yt-dlp with pip or using the wheel from PyPi; Use that to update\\n");
  process.exit(100);
}
process.exit(1);
`;

  it("tells a Homebrew install to run brew upgrade instead of blaming pip", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-update-test-"));
    cleanup.push(root);
    const cellar = path.join(root, "Cellar", "yt-dlp", "2026.8.19", "libexec", "bin");
    await mkdir(cellar, { recursive: true });
    const real = await fakeYtDlp(cellar, REFUSAL);
    const linked = path.join(root, "yt-dlp");
    await symlink(real, linked);
    process.env.TUNARRTUBE_YTDLP_PATH = linked;

    const error = await updateBinary("yt-dlp").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "YTDLP_SELF_UPDATE_UNSUPPORTED", status: 409 });
    expect((error as Error).message).toContain("installed with Homebrew");
    expect((error as Error).message).toContain("brew upgrade yt-dlp");
    expect((error as Error).message).not.toContain("pip");
  });

  it("passes yt-dlp's own reason through for other non-updatable installs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-update-test-"));
    cleanup.push(root);
    await fakeYtDlp(root, REFUSAL);

    const error = await updateBinary("yt-dlp").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "YTDLP_SELF_UPDATE_UNSUPPORTED" });
    expect((error as Error).message).toContain("You installed yt-dlp with pip or using the wheel from PyPi; Use that to update");
    expect((error as Error).message).toContain("TUNARRTUBE_YTDLP_PATH");
  });
});
