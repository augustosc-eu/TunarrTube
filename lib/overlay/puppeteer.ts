import type { Browser } from "puppeteer";

// Lazy-launch singleton, kept on globalThis so Next.js dev's module-reload doesn't leak a new
// Chromium process on every file save (same rationale as lib/db/client.ts's Prisma singleton).
const globalForPuppeteer = globalThis as unknown as { ytarrOverlayBrowser?: Promise<Browser> };

async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import("puppeteer");
  return puppeteer.default.launch({
    headless: true,
    executablePath: process.env.YTARR_PUPPETEER_EXECUTABLE_PATH || undefined,
    // --disable-dev-shm-usage: Docker's default /dev/shm is only 64MB, which Chrome can exceed
    // and crash against even for a single-page screenshot; using /tmp instead costs nothing here.
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });
}

export async function getBrowser(): Promise<Browser> {
  if (!globalForPuppeteer.ytarrOverlayBrowser) {
    // If launch() rejects, this catch clears the cached promise before the rejection propagates --
    // otherwise a single failed launch (e.g. a broken/incomplete Chromium install) would wedge every
    // future render behind the same cached rejected promise until the process restarts.
    globalForPuppeteer.ytarrOverlayBrowser = launchBrowser().catch((error) => {
      globalForPuppeteer.ytarrOverlayBrowser = undefined;
      throw error;
    });
  }
  const browser = await globalForPuppeteer.ytarrOverlayBrowser;
  if (!browser.connected) {
    globalForPuppeteer.ytarrOverlayBrowser = undefined;
    return getBrowser();
  }
  return browser;
}

export async function renderHtmlToPng(html: string, opts: { width: number; height: number }): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: opts.width, height: opts.height, deviceScaleFactor: 1 });
    // Force a transparent page background regardless of the template's own CSS, so the
    // screenshot composites cleanly over video via ffmpeg's overlay filter.
    await page.evaluateOnNewDocument(() => {
      const style = document.createElement("style");
      style.textContent = "html, body { background: transparent !important; margin: 0; padding: 0; }";
      document.documentElement.appendChild(style);
    });
    await page.setContent(html, { waitUntil: "networkidle0" });
    const screenshot = await page.screenshot({ type: "png", omitBackground: true });
    return Buffer.from(screenshot);
  } finally {
    await page.close();
  }
}
