import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "../vendor/hyperframes/packages/cli/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";

const directories = process.argv.slice(2).map((directory) => resolve(directory));
if (!directories.length) throw new Error("Pass one or more template directories");
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const failures = [];
try {
  const page = await browser.newPage();
  for (const directory of directories) {
    const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, "utf8"));
    const url = new URL(`file:///${directory.replaceAll("\\", "/")}/${manifest.entry}`).href;
    const viewports = manifest.category === "site" ? [[1280, 900], [390, 844]] : [[1280, 720]];
    for (const [width, height] of viewports) {
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.goto(url, { waitUntil: "networkidle0" });
      const pages = manifest.category === "slides" ? 6 : 1;
      for (let index = 0; index < pages; index += 1) {
        if (index) await page.keyboard.press("ArrowRight");
        const result = await page.evaluate((isSlides) => {
          const root = isSlides ? document.querySelector("[data-ipw-slide].is-active") : document.documentElement;
          const brokenImages = [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.getAttribute("src"));
          const overflowing = [...document.querySelectorAll("h1,h2,h3,p,a,button,strong,span")].filter((element) => {
            const rect = element.getBoundingClientRect();
            if (rect.width <= 1 || rect.height <= 1 || getComputedStyle(element).display === "none") return false;
            let ancestor = element.parentElement;
            while (ancestor && ancestor !== document.body) {
              const style = getComputedStyle(ancestor);
              if ([style.overflow, style.overflowX, style.overflowY].some((value) => value === "hidden" || value === "clip")) {
                const bounds = ancestor.getBoundingClientRect();
                if (rect.left < bounds.left - 2 || rect.right > bounds.right + 2 || rect.top < bounds.top - 2 || rect.bottom > bounds.bottom + 2) return true;
              }
              ancestor = ancestor.parentElement;
            }
            return false;
          }).slice(0, 8).map((element) => `${element.tagName}:${element.textContent?.trim().slice(0, 32)}`);
          return {
            brokenImages,
            overflowing,
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
            activeVisible: Boolean(root && root.getBoundingClientRect().width > 0 && root.getBoundingClientRect().height > 0),
          };
        }, manifest.category === "slides");
        if (result.brokenImages.length || result.overflowing.length || result.horizontalOverflow || !result.activeVisible) {
          failures.push({ id: manifest.id, viewport: `${width}x${height}`, page: index + 1, ...result });
        }
      }
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ checked: directories.length, failures }, null, 2));
if (failures.length) process.exit(1);
