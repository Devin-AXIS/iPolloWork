import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-layer-accordion-icons");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const projectId = "video-layer-accordion-icons-proof";
const project = join(root, "vendor/hyperframes/packages/studio/data/projects", projectId);
const projectUrl = `http://127.0.0.1:5198/#project/${projectId}?ipolloworkTheme=light&tab=assets&selFile=index.html&selHfId=proof-image&selId=proof-image&selSelector=%23proof-image`;

async function prepareProject() {
  await mkdir(join(project, "assets"), { recursive: true });
  await writeFile(join(project, "hyperframes.json"), JSON.stringify({
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
  }));
  await copyFile(join(root, "apps/app/public/default-brand-avatar.jpg"), join(project, "assets/portrait.jpg"));
  await writeFile(join(project, "index.html"),
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Layer inspector proof</title><style>body{margin:0;background:#141414}#proof{position:relative;width:1280px;height:720px;background:#15151d}img{position:absolute;left:250px;top:100px;width:500px;height:500px;object-fit:cover}</style></head><body><div data-hf-id="proof-root" id="proof" data-composition-id="' + projectId + '" data-width="1280" data-height="720" data-start="0" data-duration="8" data-fps="30"><img id="proof-image" data-hf-id="proof-image" data-start="0" data-duration="8" data-track-index="1" src="assets/portrait.jpg"></div></body></html>');
}

const groupState = '([...document.querySelectorAll("[data-flat-group]")].map(item => ({ id: item.dataset.flatGroup, open: item.dataset.flatGroupOpen === "true" })))';

async function resizeToolbar(ctx, width, layout) {
  await ctx.client.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await ctx.waitFor('document.querySelector("[data-toolbar-layout]")?.dataset.toolbarLayout === ' + JSON.stringify(layout));
}

async function assertToolbarFits(ctx) {
  const state = await ctx.eval(`(() => {
    const bar = document.querySelector("[data-toolbar-layout]");
    const outer = bar.getBoundingClientRect();
    const edit = bar.querySelector(".hf-timeline-toolbar-edit").getBoundingClientRect();
    const view = bar.querySelector(".hf-timeline-toolbar-view").getBoundingClientRect();
    const controls = [...bar.querySelectorAll("button, a, input")]
      .filter(item => !item.closest("[popover]"))
      .map(item => ({ label: item.getAttribute("aria-label"), rect: item.getBoundingClientRect().toJSON() }))
      .filter(item => item.rect.width > 0);
    return { layout: bar.dataset.toolbarLayout, width: outer.width, height: outer.height,
      gap: view.left - edit.right,
      inside: controls.every(item => item.rect.left >= outer.left && item.rect.right <= outer.right),
      overlap: controls.some((item, index) => controls.slice(index + 1).some(other => item.rect.left < other.rect.right && item.rect.right > other.rect.left)),
      labels: controls.map(item => item.label) };
  })()`);
  ctx.assert(state.height === 44 && state.gap >= 8 && state.inside && !state.overlap, "Toolbar overlap or clipping: " + JSON.stringify(state));
  ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Toolbar stays 44px high; every visible control fits without overlap", actual: state });
}

async function escape(ctx) {
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await ctx.waitFor('document.querySelectorAll(":popover-open").length === 0');
}

export default {
  id: "video-layer-accordion-icons",
  title: "Layer groups open independently and the timeline toolbar adapts without overlap",
  kind: "user-facing",
  cdpTarget: { urlIncludes: ":5198" },
  preserveTheme: true,
  steps: [
    {
      name: "Selected layer opens all relevant groups",
      run: async (ctx) => {
        await ctx.prove("A selected image opens all of its available property groups", {
          voiceover: vo[0],
          action: async () => {
            await prepareProject();
            await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
            await ctx.client.send("Page.navigate", { url: projectUrl });
            await ctx.client.send("Page.reload");
            await ctx.waitFor('Boolean(document.querySelector("button[aria-label=Layers], button[aria-label=图层]"))', { label: "Studio property tabs" });
            await ctx.eval('window.postMessage({ type: "ipollowork:studio-theme", theme: "light" }, "*")');
            await ctx.eval('window.postMessage({ type: "ipollowork:studio-locale", locale: "zh-CN" }, "*")');
            await ctx.waitFor('document.documentElement.lang === "zh-CN"');
            await ctx.trustedClick('button[aria-label="图层"]');
            await ctx.trustedClick('[role="button"][aria-label*="Proof Image"]');
            await ctx.waitFor('document.querySelectorAll("[data-flat-group]").length > 1', { label: "selected layer properties" });
          },
          assert: async () => {
            const groups = await ctx.eval(groupState);
            ctx.assert(groups.length > 1 && groups.every((group) => group.open), "Not all groups opened: " + JSON.stringify(groups));
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Every available parameter group opens for the selected image", actual: groups });
            await ctx.expectText("布局");
          },
          screenshot: { name: "all-property-groups-open", requireText: ["图层", "布局", "后处理"] },
        });
      },
    },
    {
      name: "Accordion toggles stay independent",
      run: async (ctx) => {
        await ctx.prove("Closing one property group leaves the other groups open", {
          voiceover: vo[1],
          action: async () => {
            await ctx.trustedClick('[data-flat-group="layout"] button');
            await ctx.waitFor('document.querySelector("[data-flat-group=layout]")?.dataset.flatGroupOpen !== "true"');
          },
          assert: async () => {
            const groups = await ctx.eval(groupState);
            ctx.assert(groups.length > 1 && groups.find((group) => group.id === "layout")?.open === false, "Layout did not close: " + JSON.stringify(groups));
            ctx.assert(groups.filter((group) => group.id !== "layout").every((group) => group.open), "Other groups closed: " + JSON.stringify(groups));
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Layout closes independently while every other available group remains open", actual: groups });
          },
          screenshot: { name: "independent-property-groups", requireText: ["布局", "后处理", "外观"] },
        });
      },
    },
    {
      name: "Compact timeline zoom",
      run: async (ctx) => {
        let previousZoom;
        await ctx.prove("Narrowing the editor replaces inline zoom with a working popover", {
          voiceover: vo[2],
          action: async () => {
            await resizeToolbar(ctx, 1200, "full");
            await assertToolbarFits(ctx);
            await resizeToolbar(ctx, 900, "compact");
            await ctx.trustedClick('button[aria-label="属性"]');
            await ctx.waitFor('document.querySelector("[data-toolbar-layout]")?.dataset.toolbarLayout === "full"');
            await assertToolbarFits(ctx);
            await ctx.trustedClick('button[aria-label="属性"]');
            await ctx.waitFor('document.querySelector("[data-toolbar-layout]")?.dataset.toolbarLayout === "compact"');
            await ctx.trustedClick('button[aria-label="时间轴缩放"]');
            await ctx.waitFor('document.querySelector("button[aria-label=时间轴缩放]")?.getAttribute("aria-expanded") === "true"');
            previousZoom = await ctx.eval('document.querySelector("input[aria-label=时间轴缩放]").title');
            await ctx.trustedClick(Number.parseInt(previousZoom, 10) >= 2000
              ? 'button[aria-label="缩小时间轴"]'
              : 'button[aria-label="放大时间轴"]');
          },
          assert: async () => {
            await assertToolbarFits(ctx);
            const zoom = await ctx.eval('document.querySelector("input[aria-label=时间轴缩放]").title');
            ctx.assert(zoom !== previousZoom, "Zoom controls did not change timeline zoom");
            ctx.assert(await ctx.eval('document.querySelectorAll(".hf-timeline-toolbar-group:popover-open").length === 1'), "Zoom popover is not open");
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Compact zoom popover changes the timeline zoom", actual: { before: previousZoom, after: zoom } });
          },
          screenshot: { name: "compact-zoom", requireText: ["时间轴缩放", "Proof Image"] },
        });
      },
    },
    {
      name: "More tools in a narrow editor",
      run: async (ctx) => {
        let gridBefore;
        let gridToggled;
        let gridSettingsUsable;
        await ctx.prove("The narrow toolbar keeps editing controls and opens grid and shortcuts from More", {
          voiceover: vo[3],
          action: async () => {
            await escape(ctx);
            ctx.assert(await ctx.eval('document.querySelector(\'[role=button][aria-label*="Proof Image"]\')?.getAttribute("aria-pressed") === "true"'), "Escape cleared the selected clip");
            await resizeToolbar(ctx, 700, "narrow");
            await ctx.trustedClick('button[aria-label="更多工具"]');
            await ctx.waitFor('document.querySelector("button[aria-label=更多工具]")?.getAttribute("aria-expanded") === "true"');
            gridBefore = await ctx.eval('document.querySelector("button[aria-label=显示或隐藏网格]").getAttribute("aria-pressed")');
            await ctx.trustedClick('button[aria-label="显示或隐藏网格"]');
            gridToggled = await ctx.eval('document.querySelector("button[aria-label=显示或隐藏网格]").getAttribute("aria-pressed")');
            await ctx.trustedClick('button[aria-label="显示或隐藏网格"]');
            const gridPoint = await ctx.eval('(() => { const rect = document.querySelector("button[aria-label=显示或隐藏网格]").getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()');
            await ctx.client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "right", clickCount: 1, ...gridPoint });
            await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "right", clickCount: 1, ...gridPoint });
            await ctx.waitFor(`Boolean(document.querySelector('input[type="number"][min="10"]'))`);
            gridSettingsUsable = await ctx.eval(`(() => { const input = document.querySelector('input[type="number"][min="10"]'); const rect = input.getBoundingClientRect(); return Boolean(input.closest(":popover-open")) && document.elementFromPoint(rect.left + 5, rect.top + 5) === input; })()`);
            await ctx.trustedClick('button[aria-label="快捷键与工具"]');
            await ctx.waitFor('Boolean(document.querySelector(".hf-shortcuts-panel"))');
          },
          assert: async () => {
            await assertToolbarFits(ctx);
            ctx.assert(gridBefore !== gridToggled, "More tools grid toggle did not work");
            ctx.assert(gridSettingsUsable, "Nested grid settings were obscured by the More popover");
            const state = await ctx.eval(`(() => {
              const panel = document.querySelector(".hf-shortcuts-panel");
              const rect = panel.getBoundingClientRect();
              return { grid: document.querySelector("button[aria-label=显示或隐藏网格]").getAttribute("aria-pressed"),
                shortcutsVisible: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0,
                captureVisible: document.querySelector("a[aria-label=截取当前帧]").getBoundingClientRect().width > 0,
                selected: document.querySelector('[role=button][aria-label*="Proof Image"]').getAttribute("aria-pressed") };
            })()`);
            ctx.assert(state.grid === gridBefore && state.shortcutsVisible && state.captureVisible && state.selected === "true", "More tools or selection state: " + JSON.stringify(state));
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Grid toggles and restores, capture remains available, and shortcuts open inside the viewport with the clip selected", actual: state });
          },
          screenshot: { name: "narrow-more-tools", requireText: ["更多工具", "跳转到帧", "Proof Image"] },
        });
      },
    },
    {
      name: "Restore the wide toolbar without losing state",
      run: async (ctx) => {
        let before;
        await ctx.prove("Closing and resizing the toolbar preserves selection and settings", {
          voiceover: vo[4],
          action: async () => {
            before = await ctx.eval('({ zoom: document.querySelector("input[aria-label=时间轴缩放]").title, grid: document.querySelector("button[aria-label=显示或隐藏网格]").getAttribute("aria-pressed") })');
            await escape(ctx);
            await ctx.waitFor('!document.querySelector(".hf-shortcuts-panel")');
            await ctx.trustedClick('button[aria-label="更多工具"]');
            await resizeToolbar(ctx, 1200, "full");
          },
          assert: async () => {
            await assertToolbarFits(ctx);
            const after = await ctx.eval('({ zoom: document.querySelector("input[aria-label=时间轴缩放]").title, grid: document.querySelector("button[aria-label=显示或隐藏网格]").getAttribute("aria-pressed"), selected: document.querySelector(\'[role=button][aria-label*="Proof Image"]\').getAttribute("aria-pressed"), open: document.querySelectorAll(":popover-open").length, gridButtons: document.querySelectorAll("button[aria-label=显示或隐藏网格]").length })');
            ctx.assert(after.zoom === before.zoom && after.grid === before.grid && after.selected === "true" && after.open === 0 && after.gridButtons === 1, "State was lost during resize: " + JSON.stringify({ before, after }));
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Resizing restores inline controls with no duplicated grid button, stale popover, selection loss or preference reset", actual: after });
          },
          screenshot: { name: "wide-toolbar-restored", requireText: ["Proof Image", "布局"] },
        });
      },
    },
  ],
};
