import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { getSettings, getSiteSettingsView, siteRequestSettings, updateSettings, updateSiteSetting } from "@/lib/settings/service";
import { SITES } from "@/lib/youtube/sites";
import { isRateLimitedError, runYtDlp } from "@/lib/youtube/ytdlp";

let root: string;
let globalCookies: string;
let bilibiliCookies: string;
let previousGlobal: string | null;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tunarrtube-sites-test-"));
  globalCookies = path.join(root, "global-cookies.txt");
  bilibiliCookies = path.join(root, "bilibili-cookies.txt");
  await writeFile(globalCookies, "# Netscape HTTP Cookie File\n");
  await writeFile(bilibiliCookies, "# Netscape HTTP Cookie File\n");
  previousGlobal = (await getSettings()).ytdlpCookiesPath;
  await db.siteSetting.deleteMany();
});

afterEach(async () => {
  delete process.env.TUNARRTUBE_YTDLP_PATH;
  await db.siteSetting.deleteMany();
  await db.appSettings.update({ where: { id: 1 }, data: { ytdlpCookiesPath: previousGlobal } });
  await rm(root, { recursive: true, force: true });
});

describe("site request settings", () => {
  it("falls back to the global cookies file and the site's built-in delay", async () => {
    await updateSettings({ ytdlpCookiesPath: globalCookies });
    expect(await siteRequestSettings("bilibili")).toEqual({ cookiesPath: globalCookies, sleepRequestsSeconds: 1 });
    expect(await siteRequestSettings("youtube")).toEqual({ cookiesPath: globalCookies, sleepRequestsSeconds: 0 });
  });

  it("lets a site override both, and null clears back to the fallback", async () => {
    await updateSettings({ ytdlpCookiesPath: globalCookies });
    const saved = await updateSiteSetting("bilibili", { cookiesPath: bilibiliCookies, sleepRequestsSeconds: 3 });
    expect(saved).toMatchObject({ site: "bilibili", cookiesPath: bilibiliCookies, cookiesSource: "site", effectiveSleepRequestsSeconds: 3 });
    expect(await siteRequestSettings("bilibili")).toEqual({ cookiesPath: bilibiliCookies, sleepRequestsSeconds: 3 });
    // Other sites are unaffected.
    expect((await siteRequestSettings("vimeo")).cookiesPath).toBe(globalCookies);

    const cleared = await updateSiteSetting("bilibili", { cookiesPath: null, sleepRequestsSeconds: null });
    expect(cleared).toMatchObject({ cookiesPath: null, cookiesSource: "global", effectiveCookiesPath: globalCookies, effectiveSleepRequestsSeconds: 1 });
  });

  it("leaves an omitted field alone", async () => {
    await updateSiteSetting("bilibili", { cookiesPath: bilibiliCookies });
    await updateSiteSetting("bilibili", { sleepRequestsSeconds: 5 });
    expect(await siteRequestSettings("bilibili")).toEqual({ cookiesPath: bilibiliCookies, sleepRequestsSeconds: 5 });
  });

  it("validates the cookies path like the global one", async () => {
    await expect(updateSiteSetting("vimeo", { cookiesPath: "relative/cookies.txt" })).rejects.toMatchObject({ code: "INVALID_COOKIES_PATH" });
    await expect(updateSiteSetting("vimeo", { cookiesPath: path.join(root, "missing.txt") })).rejects.toMatchObject({ code: "INVALID_COOKIES_PATH" });
  });

  it("lists every site with its requirements", async () => {
    const view = await getSiteSettingsView();
    expect(view.map((site) => site.site)).toEqual(Object.keys(SITES));
    expect(view.find((site) => site.site === "vimeo")?.signIn.level).toBe("required");
    expect(view.find((site) => site.site === "bilibili")).toMatchObject({ signIn: { level: "recommended" }, defaultSleepRequestsSeconds: 1, hasChannels: true, supportsStreaming: false });
    expect(view.find((site) => site.site === "archive")?.signIn.level).toBe("none");
  });
});

describe("site block detection", () => {
  it.each([
    "ERROR: [BiliBili] 17SjczdE3t: Unable to extract initial state; please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q= ",
    "ERROR: [BilibiliSpaceVideo] 3669403: Request is blocked by server (412), please wait and try later.",
    "ERROR: [BiliBili] 1GJ411x7h7: You have exceeded the rate limit. Try again later",
    "ERROR: [BilibiliSpaceVideo] 1: Request is rejected by server (352)"
  ])("recognizes Bilibili's block: %s", (message) => {
    expect(isRateLimitedError(message, SITES.bilibili)).toBe(true);
    expect(isRateLimitedError(message, SITES.youtube)).toBe(false);
  });

  it("still recognizes an HTTP 429 from any site", () => {
    expect(isRateLimitedError("ERROR: unable to download video data: HTTP Error 429: Too Many Requests", SITES.vimeo)).toBe(true);
    expect(isRateLimitedError("ERROR: [vimeo] 1: Video unavailable", SITES.vimeo)).toBe(false);
  });
});

describe("runYtDlp", () => {
  async function fakeYtDlp(stderr: string | null) {
    const argsFile = path.join(root, "args.json");
    const binary = path.join(root, "yt-dlp");
    await writeFile(binary, `#!/usr/bin/env node
require("fs").writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
${stderr ? `process.stderr.write(${JSON.stringify(stderr)}); process.exit(1);` : `process.stdout.write("{}");`}
`);
    await chmod(binary, 0o755);
    process.env.TUNARRTUBE_YTDLP_PATH = binary;
    return async () => JSON.parse(await readFile(argsFile, "utf8")) as string[];
  }

  it("passes the site's pinned extractors, cookies file, and request delay before the URL", async () => {
    const passedArgs = await fakeYtDlp(null);
    await updateSiteSetting("bilibili", { cookiesPath: bilibiliCookies, sleepRequestsSeconds: 2 });
    await runYtDlp(SITES.bilibili, ["--dump-single-json"], "https://www.bilibili.com/video/BV1GJ411x7h7", { timeoutMs: 30_000 });
    expect(await passedArgs()).toEqual(["--dump-single-json", "--use-extractors", "bilibili.*", "--cookies", bilibiliCookies, "--sleep-requests", "2", "--", "https://www.bilibili.com/video/BV1GJ411x7h7"]);
  });

  it("adds no delay or cookies for a site with neither", async () => {
    const passedArgs = await fakeYtDlp(null);
    await updateSettings({ ytdlpCookiesPath: null });
    await runYtDlp(SITES.archive, ["--dump-single-json"], "https://archive.org/details/x", { timeoutMs: 30_000 });
    expect(await passedArgs()).toEqual(["--dump-single-json", "--use-extractors", "archive\\.org", "--", "https://archive.org/details/x"]);
  });

  it("turns a site block into SITE_RATE_LIMITED that points at Settings → Sites", async () => {
    await fakeYtDlp("ERROR: [BiliBili] 17SjczdE3t: Unable to extract initial state; please report this issue\n");
    await updateSettings({ ytdlpCookiesPath: null });
    const error = await runYtDlp(SITES.bilibili, ["--dump-single-json"], "https://www.bilibili.com/video/BV17SjczdE3t", { timeoutMs: 30_000 }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "SITE_RATE_LIMITED", status: 429, details: { site: "bilibili" } });
    const message = (error as Error).message;
    expect(message).toContain("Bilibili is refusing requests from this connection");
    expect(message).toContain("Adding a Bilibili cookies file in Settings → Sites");
    expect(message).toContain("yt-dlp said: [BiliBili] 17SjczdE3t: Unable to extract initial state");
    expect(message).not.toContain("please report this issue");
    // The job runner recognizes its own message as a block.
    expect(isRateLimitedError(message, SITES.bilibili)).toBe(true);
  });

  it("doesn't suggest a cookies file that's already configured", async () => {
    await fakeYtDlp("ERROR: [BilibiliSpaceVideo] 1: Request is blocked by server (412), please wait and try later.\n");
    await updateSiteSetting("bilibili", { cookiesPath: bilibiliCookies });
    const error = await runYtDlp(SITES.bilibili, [], "https://space.bilibili.com/1/video", { timeoutMs: 30_000 }).catch((caught: unknown) => caught);
    expect((error as Error).message).toContain("raise its request delay in Settings → Sites");
    expect((error as Error).message).not.toContain("Adding a Bilibili cookies file");
  });

  it("leaves other failures as yt-dlp's own error", async () => {
    await fakeYtDlp("ERROR: [BiliBili] 1GJ411x7h7: This video may be deleted or geo-restricted.\n");
    await expect(runYtDlp(SITES.bilibili, [], "https://www.bilibili.com/video/BV1GJ411x7h7", { timeoutMs: 30_000 })).rejects.toMatchObject({ code: "PROCESS_FAILED" });
  });
});
