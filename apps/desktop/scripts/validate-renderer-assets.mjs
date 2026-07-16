import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const rendererDist = path.join(repoRoot, "apps/app/dist");

const requiredAssets = [
  "ipollo-work-wordmark.svg",
  "new-conversation-bg.png",
  "new-conversation-tabs/video.svg",
  "sidebar-entry-web.svg",
  "sidebar-entry-code.svg",
  "sidebar-entry-file.svg",
  "sidebar-entry-video.svg",
  "sidebar-icon/ipollo-work.svg",
  "sidebar-icon/search.svg",
  "sidebar-icon/edit.svg",
  "sidebar-icon/doc-plus.svg",
  "sidebar-icon/plugin.svg",
  "sidebar-left-expand.svg",
  "sidebar-right-open.svg",
  "sidebar-right-closed.svg",
];

function readRendererSource() {
  const indexPath = path.join(rendererDist, "index.html");
  const assetDir = path.join(rendererDist, "assets");
  const scriptNames = readdirSync(assetDir).filter((name) => name.endsWith(".js"));

  return [
    readFileSync(indexPath, "utf8"),
    ...scriptNames.map((name) => readFileSync(path.join(assetDir, name), "utf8")),
  ].join("\n");
}

const source = readRendererSource();
if (!source.includes("Presentation exported as PDF.")) {
  throw new Error("Renderer is missing the current presentation PDF export implementation.");
}
if (!source.includes("ipwPdfCompatibleColors")) {
  throw new Error("Renderer is missing packaged PDF color compatibility handling.");
}
for (const asset of requiredAssets) {
  if (!existsSync(path.join(rendererDist, asset))) {
    throw new Error(`Missing renderer asset: ${asset}`);
  }

  if (!source.includes(asset) || source.includes(`"/${asset}"`)) {
    throw new Error(`Renderer still uses an invalid packaged path for ${asset}.`);
  }
}

process.stdout.write(JSON.stringify({ ok: true, checked: requiredAssets.length }, null, 2) + "\n");
