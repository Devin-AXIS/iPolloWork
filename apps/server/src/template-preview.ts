import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const pending = new Map<string, Promise<Buffer>>();
let tail: Promise<unknown> = Promise.resolve();
const contentTypes: Record<string, string> = { html: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", mp4: "video/mp4", webm: "video/webm" };

/** Content-addressed, lazy previews: package changes invalidate the image automatically. */
export async function renderTemplatePreview(input: {
  digest: string;
  cacheRoot: string;
  entry: string;
  read: (path: string) => Promise<Buffer>;
}) {
  const key = createHash("sha256").update(`preview-v1:${input.digest}`).digest("hex");
  const destination = join(input.cacheRoot, `${key}.png`);
  try { return await readFile(destination); } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const active = pending.get(destination);
  if (active) return active;
  if (pending.size >= 32) throw new Error("template_preview_busy");
  const task = tail.then(async () => {
    const { chromium } = await import("playwright-core");
    const executablePath = process.env.IPOLLO_TEMPLATE_BROWSER || [
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
    ].find(existsSync);
    const browser = await chromium.launch({ executablePath, headless: true, timeout: 15_000 });
    const deadline = setTimeout(() => { void browser.close(); }, 25_000);
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 0.75, serviceWorkers: "block", acceptDownloads: false });
      // No cookies, host files or network. Every asset comes from this exact package.
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== "https://template.invalid") return route.abort();
        try {
          const path = decodeURIComponent(url.pathname.slice(1));
          if (!path || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) return route.abort();
          const body = await input.read(path);
          return route.fulfill({ body, contentType: contentTypes[path.split(".").at(-1)?.toLowerCase() ?? ""] ?? "application/octet-stream", headers: { "Content-Security-Policy": "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'" } });
        } catch { return route.fulfill({ status: 404, body: "Not found" }); }
      });
      await context.routeWebSocket("**/*", (socket) => socket.close());
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      page.on("dialog", (dialog) => { void dialog.dismiss(); });
      await page.goto(`https://template.invalid/${input.entry.split("/").map(encodeURIComponent).join("/")}`, { waitUntil: "load", timeout: 10_000 });
      await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 2_000))]));
      await page.evaluate(`(() => {
        const root = document.querySelector('[data-composition-id]');
        const slides = [...document.querySelectorAll('[data-ipw-slide], [data-slide], .slide, .slide-frame')];
        const frame = root || slides[0];
        if (frame) {
          const width = Number(frame.getAttribute('data-width')) || frame.offsetWidth || 1280;
          const height = Number(frame.getAttribute('data-height')) || frame.offsetHeight || 720;
          const scale = Math.min(innerWidth / width, innerHeight / height);
          document.documentElement.style.cssText += ';height:100%;overflow:hidden';
          document.body.style.cssText += ';margin:0;height:100%;overflow:hidden';
          if (!root) slides.slice(1).forEach(slide => { slide.style.display = 'none'; });
          Object.assign(frame.style, {position:'absolute',left:(innerWidth-width*scale)/2+'px',top:(innerHeight-height*scale)/2+'px',transformOrigin:'top left',transform:'scale('+scale+')',visibility:'visible',opacity:'1'});
        }
        const time = Math.min(1.5, Number(root?.getAttribute('data-duration') || 3) / 2);
        for (const clip of document.querySelectorAll('.clip[data-start][data-duration]')) {
          const start = Number(clip.getAttribute('data-start'));
          clip.style.visibility = time >= start && time < start + Number(clip.getAttribute('data-duration')) ? 'visible' : 'hidden';
        }
        for (const timeline of Object.values(window.__timelines || {})) if (typeof timeline?.seek === 'function') timeline.pause().seek(time, false);
        for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 1500; }
      })()`);
      await page.waitForTimeout(150);
      const image = await page.screenshot({ type: "png", timeout: 8_000 });
      await mkdir(input.cacheRoot, { recursive: true });
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, image);
      await rename(temporary, destination);
      return image;
    } finally { clearTimeout(deadline); await browser.close(); }
  });
  pending.set(destination, task);
  tail = task.catch(() => undefined);
  try { return await task; } finally { pending.delete(destination); }
}
