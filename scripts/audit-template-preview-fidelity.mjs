import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import puppeteer from "../vendor/hyperframes/packages/cli/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import sharp from "../vendor/hyperframes/packages/cli/node_modules/sharp/lib/index.js";

const templateIds = [
  "ipollowork.pptx-product-launch",
  "ipollowork.pptx-annual-review",
  "ipollowork.pptx-research-signals",
  "ipollowork.pptx-brand-narrative",
  "ipollowork.pptx-venture-blueprint",
  "ipollowork.site-atelier-architecture",
  "ipollowork.site-orbit-data",
  "ipollowork.site-casa-lume",
  "ipollowork.site-forma-portfolio",
  "ipollowork.site-kindred-care",
  "ipollowork.pptx-clinical-handoff",
  "ipollowork.pptx-urban-mobility",
  "ipollowork.pptx-exhibition-curation",
  "ipollowork.pptx-supply-continuity",
  "ipollowork.pptx-learning-journey",
  "ipollowork.pptx-restaurant-opening",
  "ipollowork.pptx-film-treatment",
  "ipollowork.pptx-impact-report",
  "ipollowork.pptx-merger-integration",
  "ipollowork.pptx-match-analysis",
  "ipollowork.site-tidehouse-hotel",
  "ipollowork.site-northstar-clinic",
  "ipollowork.site-afterglow-festival",
  "ipollowork.site-fieldstone-realty",
  "ipollowork.site-ember-table",
  "ipollowork.site-openhands-foundation",
  "ipollowork.site-relay-developer",
  "ipollowork.site-commonform-careers",
  "ipollowork.site-archive-museum",
  "ipollowork.site-vector-freight",
];

const templatesRoot = resolve("apps/server/bundled-templates");
const reportOnly = process.argv.includes("--report-only");

function browserCandidates() {
  return [
    process.env.IPOLLOWORK_COVER_BROWSER,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/microsoft-edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
}

function browserExecutable() {
  const executable = browserCandidates().find((candidate) => existsSync(candidate));
  if (!executable) throw new Error("No Edge, Chrome, or Chromium executable found");
  return executable;
}

async function imageDifference(left, right) {
  const options = { width: 120, height: 68, fit: "fill" };
  const [leftPixels, rightPixels] = await Promise.all([
    sharp(left).flatten({ background: "#ffffff" }).resize(options).removeAlpha().raw().toBuffer(),
    sharp(right).flatten({ background: "#ffffff" }).resize(options).removeAlpha().raw().toBuffer(),
  ]);
  let difference = 0;
  for (let index = 0; index < leftPixels.length; index += 1) {
    difference += Math.abs(leftPixels[index] - rightPixels[index]);
  }
  return difference / leftPixels.length / 255;
}

async function pageSnapshot(page, category) {
  return page.evaluate((surface) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
    };
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value));
    };
    const keyElements = surface === "slides"
      ? [...document.querySelectorAll("[data-ipw-slide].is-active [data-pptx-text], [data-ipw-slide].is-active [data-pptx-shape], [data-ipw-slide].is-active [data-pptx-image]")]
      : [...document.querySelectorAll("header, nav, main section, main > div, footer")];
    return {
      slides: document.querySelectorAll("[data-ipw-slide]").length,
      pptxText: document.querySelectorAll("[data-pptx-text]").length,
      pptxShape: document.querySelectorAll("[data-pptx-shape]").length,
      pptxImage: document.querySelectorAll("[data-pptx-image]").length,
      sectionOrder: [...document.querySelectorAll("main section")].map((element) => element.id || element.className),
      landmarks: [...document.querySelectorAll("body > header, body > nav, body > main, body > footer")].map((element) => element.tagName.toLowerCase()),
      boxes: keyElements.filter(visible).slice(0, 80).map(box),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  }, category);
}

function geometryDrift(before, after) {
  if (before.length !== after.length || before.length === 0) return 1;
  let drift = 0;
  for (let index = 0; index < before.length; index += 1) {
    const base = before[index];
    const current = after[index];
    for (let coordinate = 0; coordinate < 4; coordinate += 1) {
      drift += Math.min(1, Math.abs(base[coordinate] - current[coordinate]) / Math.max(24, Math.abs(base[coordinate])));
    }
  }
  return drift / before.length / 4;
}

async function simulateAiContentRewrite(page) {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        const value = node.textContent?.trim() ?? "";
        if (!parent || !value || parent.closest("script, style, svg, code, pre")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const original = node.textContent ?? "";
      const leading = original.match(/^\s*/)?.[0] ?? "";
      const trailing = original.match(/\s*$/)?.[0] ?? "";
      const length = original.trim().length;
      const phrase = length < 8 ? "New idea" : length < 24 ? "A clearer new direction" : "A clearer narrative shaped for this audience and its next decision";
      const repeated = phrase.repeat(Math.max(1, Math.ceil(length / phrase.length))).slice(0, Math.max(1, length));
      node.textContent = `${leading}${repeated}${trailing}`;
    }
  });
}

function sameStructure(before, after) {
  return before.slides === after.slides
    && before.pptxText === after.pptxText
    && before.pptxShape === after.pptxShape
    && before.pptxImage === after.pptxImage
    && JSON.stringify(before.sectionOrder) === JSON.stringify(after.sectionOrder)
    && JSON.stringify(before.landmarks) === JSON.stringify(after.landmarks);
}

const browser = await puppeteer.launch({
  executablePath: browserExecutable(),
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files"],
});
const results = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 1 });
  for (const id of templateIds) {
    const directory = join(templatesRoot, id);
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    const entryUrl = new URL(`file:///${join(directory, manifest.entry).replaceAll("\\", "/")}`).href;
    await page.goto(entryUrl, { waitUntil: "networkidle0" });
    const before = await pageSnapshot(page, manifest.category);
    const rendered = await page.screenshot({ type: "png" });
    const coverDifference = await imageDifference(rendered, join(directory, manifest.cover));
    await simulateAiContentRewrite(page);
    const after = await pageSnapshot(page, manifest.category);
    const rewritten = await page.screenshot({ type: "png" });
    const rewrittenDifference = await imageDifference(rendered, rewritten);
    const drift = geometryDrift(before.boxes, after.boxes);
    const structurePreserved = sameStructure(before, after);
    const passed = coverDifference <= 0.035
      && structurePreserved
      && drift <= 0.12
      && rewrittenDifference <= 0.34
      && !before.horizontalOverflow
      && !after.horizontalOverflow;
    results.push({
      id,
      category: manifest.category,
      passed,
      coverDifference: Number(coverDifference.toFixed(4)),
      rewrittenDifference: Number(rewrittenDifference.toFixed(4)),
      geometryDrift: Number(drift.toFixed(4)),
      structurePreserved,
      slides: before.slides,
      sections: before.sectionOrder.length,
      pptxMarkers: before.pptxText + before.pptxShape + before.pptxImage,
    });
  }
} finally {
  await browser.close();
}

const failures = results.filter((result) => !result.passed);
console.log(JSON.stringify({ checked: results.length, passed: results.length - failures.length, failures, results }, null, 2));
if (failures.length && !reportOnly) process.exit(1);
