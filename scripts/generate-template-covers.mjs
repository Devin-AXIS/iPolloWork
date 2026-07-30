import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "../vendor/hyperframes/packages/cli/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";

const directories = process.argv.slice(2).map((directory) => resolve(directory));
if (!directories.length) throw new Error("Pass one or more template directories");

function browserCandidates() {
  return [
    process.env.IPOLLOWORK_COVER_BROWSER,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/microsoft-edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
}

function resolveBrowserExecutable() {
  for (const candidate of browserCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("No browser executable found. Set IPOLLOWORK_COVER_BROWSER to the Edge, Chrome, or Chromium executable used for template cover rendering.");
}

const browser = await puppeteer.launch({ executablePath: resolveBrowserExecutable(), headless: true, args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 1 });
  for (const directory of directories) {
    const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, "utf8"));
    await page.goto(new URL(`file:///${directory.replaceAll("\\", "/")}/${manifest.entry}`).href, { waitUntil: "networkidle0" });
    await page.screenshot({ path: `${directory}/cover.png`, type: "png", clip: { x: 0, y: 0, width: 960, height: 540 } });
    console.log(`Rendered ${manifest.id}`);
  }
} finally {
  await browser.close();
}
