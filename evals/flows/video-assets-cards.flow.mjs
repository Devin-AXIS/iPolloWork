import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-assets-cards");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const projectId = "video-assets-cards-proof";
const project = join(root, "vendor/hyperframes/packages/studio/data/projects", projectId);
const composition = join(project, "index.html");
const projectUrl = "http://127.0.0.1:5198/#project/" + projectId + "?ipolloworkTheme=light&tab=assets";
const card = (name) => '[data-testid="asset-card"][data-asset-path="assets/' + name + '"]';

async function resetProofProject() {
  await mkdir(join(project, "assets"), { recursive: true });
  await writeFile(join(project, "hyperframes.json"), JSON.stringify({
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
  }));
  await Promise.all([
    copyFile(join(root, "apps/app/public/default-brand-avatar.jpg"), join(project, "assets/used-portrait.jpg")),
    copyFile(join(root, "apps/app/public/ext-image-studio.png"), join(project, "assets/unused-image.png")),
    copyFile(join(root, "vendor/hyperframes/packages/studio/tests/e2e/fixtures/design-panel-qa/assets/test.mp4"), join(project, "assets/sample-video.mp4")),
  ]);
  await writeFile(composition,
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Asset cards proof</title><style>body{margin:0;background:#141414} #proof{position:relative;width:1280px;height:720px;background:#15151d}img{position:absolute;left:250px;top:100px;width:500px;height:500px;object-fit:cover}</style></head><body><div data-hf-id="hf-rov6" id="proof" data-composition-id="' + projectId + '" data-width="1280" data-height="720" data-start="0" data-duration="8" data-fps="30"><img id="used-image" data-hf-id="used-image" data-start="0" data-duration="8" data-track-index="1" src="assets/used-portrait.jpg"></div></body></html>');
}

async function hoverCard(ctx, selector) {
  const point = await ctx.waitFor('(() => { const item = document.querySelector(' + JSON.stringify(selector) + '); if (!item) return null; item.scrollIntoView({ block: "center" }); const box = item.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + 40 }; })()', { label: "asset card" });
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
}

export default {
  id: "video-assets-cards",
  title: "Video assets use compact cards with preview, insert, and locate actions",
  kind: "user-facing",
  cdpTarget: { urlIncludes: ":5198" },
  preserveTheme: true,
  steps: [
    {
      name: "Search and import without a dead source selector",
      run: async (ctx) => {
        await ctx.prove("The asset header exposes working search and import without Source", {
          voiceover: vo[0],
          action: async () => {
            await resetProofProject();
            await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
            await ctx.client.send("Page.navigate", { url: projectUrl });
            await ctx.waitFor('Boolean(document.querySelector(\'button[aria-label="Properties"], button[aria-label="属性"]\'))', { label: "Studio editor" });
            if (!(await ctx.eval('Boolean(document.querySelector(\'button[aria-label="Assets"], button[aria-label="素材"]\'))'))) {
              await ctx.trustedClick('button[aria-label="Properties"], button[aria-label="属性"]');
            }
            await ctx.trustedClick('button[aria-label="Assets"], button[aria-label="素材"]');
            await ctx.waitFor('Boolean(document.querySelector(' + JSON.stringify(card("used-portrait.jpg")) + '))', { label: "asset panel loaded" });
            await ctx.eval('window.postMessage({ type: "ipollowork:studio-theme", theme: "light" }, "*")');
            await ctx.waitFor('document.documentElement.dataset.ipolloworkTheme === "light"');
            await ctx.eval('window.postMessage({ type: "ipollowork:studio-locale", locale: "zh-CN" }, "*")');
            await ctx.waitFor('document.documentElement.lang === "zh-CN"');
            await ctx.fill('input[type="search"]', "used-portrait");
            await ctx.waitFor('document.querySelectorAll("[data-testid=asset-card]").length === 1');
            await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1100, y: 400 });
          },
          assert: async () => {
            const header = await ctx.eval('(() => { const input = document.querySelector("input[type=search]")?.closest("label"); const button = [...document.querySelectorAll("button")].find(item => item.textContent.trim() === "导入"); const a = input?.getBoundingClientRect(); const b = button?.getBoundingClientRect(); return { inputHeight: a?.height, importHeight: b?.height, sameRow: Math.abs((a?.top ?? 0) - (b?.top ?? 100)) < 2, count: document.querySelectorAll("[data-testid=asset-card]").length, hasSource: document.body.innerText.includes("来源") }; })()');
            ctx.assert(header.inputHeight === 34 && header.importHeight === 34 && header.sameRow, "Search and import alignment: " + JSON.stringify(header));
            ctx.assert(header.count === 1 && !header.hasSource, "Search or Source state: " + JSON.stringify(header));
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Search and import are aligned at 34px; Source is absent; search returns one asset", actual: header });
            await ctx.expectText("used-portrait.jpg");
          },
          screenshot: { name: "search-import", requireText: ["导入", "used-portrait.jpg"], rejectText: ["来源"] },
        });
      },
    },
    {
      name: "Equal image and video card heights",
      run: async (ctx) => {
        await ctx.prove("Images and videos share 100px thumbnails and show usage near the preview", {
          voiceover: vo[1],
          action: async () => {
            await ctx.fill('input[type="search"]', "");
            await ctx.waitFor('document.querySelectorAll("[data-testid=asset-card]").length === 3');
          },
          assert: async () => {
            const state = await ctx.eval('(() => [...document.querySelectorAll("[data-testid=asset-card]")].map(item => ({ path: item.getAttribute("data-asset-path"), height: item.children[1]?.getBoundingClientRect().height, used: item.textContent.includes("使用中"), draggable: item.draggable })))()');
            ctx.assert(state.length === 3 && state.every(item => item.height === 100 && item.draggable), "Card heights or drag affordance: " + JSON.stringify(state));
            ctx.assert(state.find(item => item.path?.endsWith("used-portrait.jpg"))?.used, "Used badge missing: " + JSON.stringify(state));
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "All three image/video cards have 100px thumbnails, support drag, and the used image carries its badge", actual: state });
            await ctx.expectText("sample-video.mp4");
          },
          screenshot: { name: "equal-card-heights", requireText: ["used-portrait.jpg", "unused-image.png", "sample-video.mp4", "使用中"] },
        });
      },
    },
    {
      name: "Hover affordance and preview",
      run: async (ctx) => {
        let hoveredVideo = false;
        let usedPreview = false;
        await ctx.prove("Hover reveals actions and muted video; used and unused assets both preview", {
          voiceover: vo[2],
          action: async () => {
            await hoverCard(ctx, card("sample-video.mp4"));
            await ctx.waitFor('Boolean(document.querySelector(' + JSON.stringify(card("sample-video.mp4") + " video") + '))', { label: "video hover preview" });
            await ctx.waitFor('Number(getComputedStyle(document.querySelector(' + JSON.stringify(card("sample-video.mp4") + " [data-testid=asset-insert-action]") + ').parentElement).opacity) > 0.9', { label: "hover action fully visible" });
            hoveredVideo = Boolean(await ctx.eval('(() => { const item = document.querySelector(' + JSON.stringify(card("sample-video.mp4")) + '); const video = item?.querySelector("video"); const button = item?.querySelector("[data-testid=asset-insert-action]"); return video?.muted && video?.autoplay && button && Number(getComputedStyle(button.parentElement).opacity) > 0.9; })()'));
            await ctx.trustedClick(card("used-portrait.jpg") + ' button[aria-label^="预览"]');
            await ctx.waitFor('document.querySelector("[role=dialog]")?.getAttribute("aria-label")?.includes("used-portrait.jpg")');
            usedPreview = true;
            await ctx.trustedClick('[role=dialog] button[aria-label="关闭预览"]');
            await ctx.trustedClick(card("unused-image.png") + ' button[aria-label^="预览"]');
            await ctx.waitFor('document.querySelector("[role=dialog]")?.getAttribute("aria-label")?.includes("unused-image.png")');
          },
          assert: async () => {
            ctx.assert(hoveredVideo && usedPreview, "Hover or used-image preview failed");
            ctx.assert(Boolean(await ctx.eval('document.querySelector("[role=dialog]")?.getAttribute("aria-label")?.includes("unused-image.png")')), "Unused image preview missing");
            ctx.assert(!(await readFile(composition, "utf8")).includes('src="assets/unused-image.png"'), "Preview inserted an asset unexpectedly");
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Hovered video plays muted, card actions are visible, both images open the preview, and preview does not insert" });
          },
          screenshot: { name: "asset-preview", requireText: ["unused-image.png"] },
        });
      },
    },
    {
      name: "Locate and insert from the asset card",
      run: async (ctx) => {
        let located = false;
        await ctx.prove("Locate selects the used clip and Insert writes a new timeline clip", {
          voiceover: vo[3],
          action: async () => {
            await ctx.trustedClick('[role=dialog] button[aria-label="关闭预览"]');
            await ctx.trustedClick(card("used-portrait.jpg") + " [data-testid=asset-locate-action]");
            located = Boolean(await ctx.eval('Boolean(document.querySelector(\'[role=button][aria-label*="Used Image"][aria-pressed="true"]\'))'));
            await ctx.trustedClick(card("unused-image.png") + " [data-testid=asset-insert-action]");
            await ctx.waitFor('document.body.innerText.includes("Unused Image")', { label: "inserted image on timeline" });
          },
          assert: async () => {
            ctx.assert(located, "Locate did not select the used timeline clip");
            ctx.assert((await readFile(composition, "utf8")).includes('src="assets/unused-image.png"'), "Insert did not persist a new image clip");
            const state = await ctx.eval('(() => ({ clips: [...document.querySelectorAll("[role=button][aria-label]")].map(item => item.getAttribute("aria-label")).filter(label => label.includes("Used Image") || label.includes("Unused Image")), videoDraggable: document.querySelector(' + JSON.stringify(card("sample-video.mp4")) + ')?.draggable }))()');
            ctx.assert(state.clips.some(label => label.includes("Used Image")) && state.clips.some(label => label.includes("Unused Image")) && state.videoDraggable, "Timeline or drag state: " + JSON.stringify(state));
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Locate selected the used clip; Insert persisted another timeline clip; video cards remain draggable", actual: state });
            await ctx.expectText("Unused Image");
          },
          screenshot: { name: "inserted-on-timeline", requireText: ["Unused Image", "使用中"] },
        });
      },
    },
  ],
};
