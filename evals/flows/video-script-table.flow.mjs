import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

// Dedicated local Studio fixture only: never navigate or mutate the user's active video.
const fixture = new URL(
  "../../vendor/hyperframes/packages/studio/data/projects/storyboard-table-layout-eval/",
  import.meta.url,
);
const script = new URL("STORYBOARD.md", fixture);
const url = `http://127.0.0.1:5198/?view=storyboard&locale=zh&evalRun=${Date.now()}#project/storyboard-table-layout-eval?ipolloworkTheme=light`;
const vo = await loadVoiceoverParagraphs("video-script-table");
const requireStudio = createRequire(
  new URL("../../vendor/hyperframes/packages/studio/package.json", import.meta.url),
);
const puppeteer = requireStudio("puppeteer-core");
const label = (value) => `[aria-label=${JSON.stringify(value)}]`;
async function click(ctx, selector) {
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await ctx.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function titles(ctx) {
  return ctx.eval(
    `Array.from(document.querySelectorAll('textarea[aria-label^="镜头内容"]')).map(input => input.value.split("\\n")[0])`,
  );
}
async function reload(ctx) {
  const previousDocument = await ctx.eval("performance.timeOrigin");
  await ctx.client.send("Page.reload");
  await ctx.waitFor(
    `performance.timeOrigin !== ${previousDocument} && document.readyState === 'complete'`,
  );
}
let originalComposition;

export default {
  id: "video-script-table",
  title: "Editable production script: real assets, narration, spatial camera and save",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "project/storyboard-table-layout-eval" },
  steps: [
    {
      name: "Complete script editing journey",
      run: async (ctx) => {
        await ctx.client.send("Emulation.setDeviceMetricsOverride", {
          width: 1440,
          height: 1200,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await mkdir(fixture, { recursive: true });
        await mkdir(new URL("assets/", fixture), { recursive: true });
        await writeFile(
          new URL("assets/city image %231.svg", fixture),
          '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#e5eeee"/><rect x="90" y="160" width="180" height="290" rx="12" fill="#226966"/><rect x="340" y="90" width="220" height="360" rx="12" fill="#3a8581"/><rect x="630" y="210" width="200" height="240" rx="12" fill="#69aaa5"/><text x="90" y="70" font-family="sans-serif" font-size="32" fill="#123d3a">SCRIPT MATERIAL PREVIEW</text></svg>',
        );
        const ffmpeg = promisify(execFile);
        await ffmpeg("ffmpeg", [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=teal:s=320x180:d=1",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          fileURLToPath(new URL("assets/preview.mp4", fixture)),
        ]);
        await ffmpeg("ffmpeg", [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=1",
          fileURLToPath(new URL("assets/preview.wav", fixture)),
        ]);
        await writeFile(
          new URL("index.html", fixture),
          '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Script table verification</title></head><body><main data-composition-id="main" data-start="0" data-duration="10" data-width="1920" data-height="1080"><h1>Script table verification</h1></main><script>window.__timelines = {};</script></body></html>',
          { flag: "wx" },
        ).catch((error) => {
          if (error.code !== "EEXIST") throw error;
        });
        originalComposition = await readFile(new URL("index.html", fixture), "utf8");
        ctx.assert(
          originalComposition.includes("Script table verification"),
          "Only the dedicated fixture may be changed",
        );
        // Retain any previous fixture draft, and start the creation path with no script file.
        await rename(script, new URL(`previous-run-${Date.now()}.md`, fixture)).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
        await ctx.client.send("Page.navigate", { url });
        await ctx.waitForText("从第一个镜头开始");
        await ctx.eval(`window.postMessage({type:'ipollowork:studio-theme',theme:'light'}, '*')`);
        await ctx.waitFor(`document.documentElement.dataset.ipolloworkTheme === 'light'`);

        await ctx.prove("The Script entry creates an editable plan without a markdown editor", {
          voiceover: vo[0],
          action: async () => {
            await ctx.clickText("添加镜头");
          },
          assert: async () => {
            await ctx.waitFor(`document.querySelectorAll('tr[data-shot]').length === 1`);
            ctx.assert(
              await ctx.eval(
                `document.querySelector('[role="tab"][aria-selected="true"]').textContent.trim() === '脚本表'`,
              ),
              "Script is the active header tab",
            );
          },
          screenshot: {
            name: "script-create",
            requireText: ["脚本表", "画面与场景", "添加镜头"],
          },
        });

        await ctx.prove("Theme, music, narration voice and a real spatial recipe stay in one script", {
          voiceover: vo[1],
          action: async () => {
            await ctx.eval(
              `window.__themeRequests = []; window.addEventListener('message', event => { if(event.data?.type === 'ipollowork:video-studio-select-theme') { window.__themeRequests.push(event.data.themeId); window.dispatchEvent(new MessageEvent('message', {source:window, data:{type:'ipollowork:video-studio-theme-result',projectId:'storyboard-table-layout-eval',requestId:event.data.requestId,themeId:event.data.themeId,applied:true}})); window.dispatchEvent(new MessageEvent('message', {source: window, data: {type: 'ipollowork:studio-host-context', projectId: 'storyboard-table-layout-eval', designSystem: {id: event.data.themeId, name: event.data.themeId === 'editorial' ? 'Editorial' : 'Agentic'}, designSystemThemes: [{id:'agentic', name:'Agentic', category:'Product'}, {id:'editorial', name:'Editorial', category:'Studio'}]}})); }}); window.dispatchEvent(new MessageEvent('message', {source: window, data: {type: 'ipollowork:studio-host-context', projectId: 'storyboard-table-layout-eval', title: 'Script table verification', designSystem: {id: 'agentic', name: 'Agentic'}, designSystemThemes: [{id:'agentic', name:'Agentic', category:'Product'}, {id:'editorial', name:'Editorial', category:'Studio'}], actions: {openDesignSystem: true}}}))`,
            );
            await ctx.clickText("手动选择主题");
            await ctx.waitFor(`document.querySelector(${JSON.stringify(label("选择视频主题"))})?.options.length > 1`);
            await ctx.eval(
              `(() => { const el = document.querySelector(${JSON.stringify(label("选择视频主题"))}); el.value = 'editorial'; el.dispatchEvent(new Event('change', {bubbles:true})); })()`,
            );
            await ctx.fill(label("全片配乐要求"), "克制的电子氛围铺底，情绪从好奇逐渐走向坚定，不盖过旁白");
            await click(ctx, `${label("配乐方式")} button:nth-child(2)`);
            await click(ctx, label("浏览音频素材 0"));
            await click(ctx, `${label("选择已有音频 0")} ${label("选择素材: preview.wav")}`);
            await ctx.fill(label("全片画面风格"), "克制、明亮的产品纪录片质感");
            await ctx.fill(
              label("镜头内容 1"),
              "城市开场\n清晨的城市航拍，数据线汇聚到 iPolloWork 工作台。",
            );
            await ctx.eval(`window.dispatchEvent(new MessageEvent('message', {source: window, data: {type: 'ipollowork:video-studio-voice-selected', projectId: 'storyboard-table-layout-eval', frameIndex: 1, voiceId: 'longanyang', model: 'cosyvoice-v3-flash', name: '龙安阳', source: 'preset'}}))`);
            await ctx.fill(label("旁白 1"), "从一个想法，到一支数字团队。");
            await ctx.waitFor(`Array.from(document.querySelector(${JSON.stringify(label("空间运镜编排 1"))})?.options ?? []).some(option => option.value === 'depth-layer-moves')`);
            await ctx.eval(`(() => { const el = document.querySelector(${JSON.stringify(label("空间运镜编排 1"))}); el.value = 'depth-layer-moves'; el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
            await click(ctx, `${label("素材来源 1")} button:nth-child(2)`);
            await ctx.fill(label("素材需求 / 生成描述 1"), "冷白晨光中的未来城市，留出文字区域");
            await ctx.fill(label("音效与触发时机 1"), "第 2 秒数据汇聚时轻脆提示音");
          },
          assert: async () => {
            ctx.assert(
              await ctx.eval(
                `document.querySelector(${JSON.stringify(label("素材来源 1"))}).querySelector('button[aria-pressed="true"]')?.textContent.includes('AI 生成')`,
              ),
              "Generation choice persisted in draft",
            );
            ctx.assert(
              await ctx.eval(
                `document.querySelector(${JSON.stringify(label("全片配乐要求"))}).value.includes('电子氛围') && document.querySelector(${JSON.stringify(label("全片画面风格"))}).value.includes('纪录片')`,
              ),
              "Natural-language music direction and visual style reflect the edit",
            );
            ctx.assert(
              await ctx.eval(
                `document.querySelector(${JSON.stringify(label("选择视频主题"))}).value === 'editorial' && window.__themeRequests.includes('editorial')`,
              ),
              "Theme choice is sent to the host for shared theme application",
            );
            ctx.assert(
              await ctx.eval(
                `document.querySelector(${JSON.stringify(label("镜头内容 1"))}).value.split("\\n")[1].includes("清晨的城市航拍")`,
              ),
              "Shot title and picture description share one content field",
            );
            ctx.assert(
              await ctx.eval(
                `document.querySelector(${JSON.stringify(label("选择旁白声线 1"))})?.textContent.includes('龙安阳') && !document.querySelector(${JSON.stringify(label("角色 / 说话人 1"))})`,
              ),
              "Narration uses one voice choice with no redundant role-name input",
            );
            ctx.assert(
              await ctx.eval(
                `document.querySelector(${JSON.stringify(label("空间运镜编排 1"))})?.value === 'depth-layer-moves' && !document.querySelector(${JSON.stringify(label("浏览音频素材 0"))}).getAttribute('aria-expanded').includes('true')`,
              ),
              "A real spatial camera recipe is selected and the audio picker collapses after choosing",
            );
          },
          screenshot: {
            name: "script-production",
            requireText: ["视频主题", "全片配乐", "景深层移", "音效", "未保存修改"],
          },
        });

        await ctx.prove("Shots support pointer drag, keyboard reorder and safe deletion", {
          voiceover: vo[2],
          action: async () => {
            await ctx.clickText("添加镜头");
            await ctx.fill(label("镜头内容 2"), "产品演示");
            await ctx.clickText("添加镜头");
            await ctx.fill(label("镜头内容 3"), "收尾号召");
            const browser = await puppeteer.connect({
              browserURL: ctx.cdpBaseUrl,
              defaultViewport: null,
            });
            try {
              const page = (await browser.pages()).find((page) => page.url().includes("5198"));
              ctx.assert(Boolean(page), "Fixture page exists");
              await page.bringToFront();
              // Keep both handles visible throughout native HTML drag; scrolling
              // the target into view after dragging can move the source away.
              await page.setViewport({ width: 1440, height: 1800 });
              await page.$eval(".hf-script-table-scroll", (element) => (element.scrollTop = 0));
              const from = await page.$(label("移动镜头 3"));
              const to = await page.$(label("移动镜头 1"));
              const start = await from.boundingBox();
              const end = await to.boundingBox();
              await page.setDragInterception(true);
              await page.mouse.dragAndDrop(
                { x: start.x + start.width / 2, y: start.y + start.height / 2 },
                { x: end.x + end.width / 2, y: end.y + end.height / 2 },
                { delay: 100 },
              );
              await page.setDragInterception(false);
              await ctx.waitFor(
                `document.querySelector(${JSON.stringify(label("镜头内容 1"))}).value.split("\\n")[0] === '收尾号召'`,
              );
              ctx.assert(
                (await titles(ctx)).join("|") === "收尾号召|城市开场|产品演示",
                "Native drag moved the complete shot",
              );
              await page.focus(label("移动镜头 1"));
              await page.keyboard.press("ArrowDown");
              await ctx.waitFor(
                `document.querySelector(${JSON.stringify(label("镜头内容 1"))}).value.split("\\n")[0] === '城市开场'`,
              );
              page.once("dialog", (dialog) => dialog.accept());
              await page.click(label("删除镜头 2"));
            } finally {
              browser.disconnect();
            }
          },
          assert: async () => {
            await ctx.waitFor(`document.querySelectorAll('tr[data-shot]').length === 2`);
            await ctx.waitFor(
              `Array.from(document.querySelectorAll('textarea[aria-label^="镜头内容"]')).map(input => input.value.split("\\n")[0]).join('|') === '城市开场|产品演示'`,
            );
            ctx.assert(
              (await titles(ctx)).join("|") === "城市开场|产品演示",
              "Remaining shot order is correct",
            );
            ctx.assert(
              (await readFile(new URL("index.html", fixture), "utf8")) === originalComposition,
              "Plan deletion did not change the video",
            );
          },
          screenshot: {
            name: "script-reorder",
            requireText: ["2 个镜头", "未保存修改"],
          },
        });

        await ctx.prove(
          "Camera and materials are separate, with working image, video and audio previews",
          {
            voiceover: vo[7],
            action: async () => {
              const browser = await puppeteer.connect({
                browserURL: ctx.cdpBaseUrl,
                defaultViewport: null,
              });
              try {
                const page = (await browser.pages()).find((page) =>
                  page.url().includes("storyboard-table-layout-eval"),
                );
                ctx.assert(
                  await ctx.eval(`document.querySelectorAll('thead th').length === 8`),
                  "Eight independent columns",
                );
                ctx.assert(
                  await ctx.eval(
              `document.querySelector('[aria-label^="选择一个运镜 1"]')?.closest('td') !== document.querySelector(${JSON.stringify(label("素材来源 1"))}).closest('td')`,
                  ),
                  "Camera and material inputs have distinct cells",
                );
                await page.click(`${label("素材来源 1")} button:nth-child(1)`);
                await ctx.fill(label("素材需求 / 生成描述 1"), "城市数字化新闻报道中的实际场景资料");
                await page.select(label("素材类型 1"), "image");
                await page.click(label("浏览图片视频素材 1"));
                ctx.assert(
                  !(await page.$(`${label("选择已有图片或视频 1")} ${label("选择素材: preview.wav")}`)) &&
                    !(await page.$(`${label("选择已有图片或视频 1")} ${label("选择素材: preview.mp4")}`)),
                  "Image-only material picker excludes video and audio",
                );
                await page.click(label("选择素材: city image #1.svg"));
                ctx.assert(
                  await page.$eval(label("浏览图片视频素材 1"), (el) => el.getAttribute("aria-expanded") === "false"),
                  "Selecting media collapses the asset list",
                );
                await page.click(label("预览: city image #1.svg"));
                await ctx.waitFor(
                  `(() => {const image=document.querySelector('[role="dialog"][aria-label="素材预览"] img'); return image?.complete && image.naturalWidth === 960;})()`,
                );
                ctx.assert(
                  await ctx.eval(
                    `document.querySelector('[role="dialog"][aria-label="素材预览"] img').src.includes('city%20image%20%231.svg')`,
                  ),
                  "Local filenames with spaces and # are served correctly",
                );
                await ctx.screenshot("script-image-preview", {
                  claim: "A referenced image opens full-size without leaving the script",
                  voiceover: vo[7],
                  requireText: ["素材预览", "city image #1.svg"],
                });
                await page.keyboard.press("Escape");
                await ctx.waitFor(
                  `!document.querySelector('[role="dialog"][aria-label="素材预览"]')`,
                );
                ctx.assert(
                  await page.$eval(
                    label("预览: city image #1.svg"),
                    (el) => el === document.activeElement,
                  ),
                  "Closing restores keyboard focus to the opened material",
                );
                for (const [file, tag, browse, group] of [
                  ["preview.mp4", "video", "浏览图片视频素材 1", "选择已有图片或视频 1"],
                  ["preview.wav", "audio", "浏览音频素材 1", "选择已有音频 1"],
                ]) {
                  if (tag === "video") await page.select(label("素材类型 1"), "video");
                  await page.click(label(browse));
                  await page.click(`${label(group)} ${label(`选择素材: ${file}`)}`);
                  await page.click(`${label(group)} ${label(`预览: ${file}`)}`);
                  await ctx.waitFor(
                    `(() => {const media=document.querySelector('[role="dialog"][aria-label="素材预览"] ${tag}'); return media?.readyState >= 1 && Number.isFinite(media.duration) && media.duration > 0 && media.controls && !media.muted;})()`,
                  );
                  await page.$eval(`[role="dialog"][aria-label="素材预览"] ${tag}`, (el) =>
                    el.play(),
                  );
                  await ctx.waitFor(
                    `document.querySelector('[role="dialog"][aria-label="素材预览"] ${tag}').currentTime > 0.05`,
                  );
                  await page.click(label("关闭预览"));
                  await ctx.waitFor(
                    `!document.querySelector('[role="dialog"][aria-label="素材预览"]')`,
                  );
                }
                await page.select(label("素材类型 1"), "image");
                await page.click(label("浏览图片视频素材 1"));
                await ctx.fill(label("查找图片视频素材 1"), "city");
                await page.click(label("选择素材: city image #1.svg"));
                await ctx.waitFor(
                  `document.querySelector('tr[data-shot="1"] button img')?.naturalWidth === 960`,
                );
                await ctx.client.send("Emulation.setDeviceMetricsOverride", {
                  width: 1440,
                  height: 900,
                  deviceScaleFactor: 1,
                  mobile: false,
                });
                await page.focus(label("镜头内容 1"));
              } finally {
                browser.disconnect();
              }
            },
            assert: async () => {
              ctx.assert(
                await ctx.eval(
                  `Boolean(document.querySelector(${JSON.stringify(label("素材来源 1"))}).querySelector('button[aria-pressed="true"]')?.textContent.includes('AI 决定') && document.querySelector(${JSON.stringify(label("预览: city image #1.svg"))}))`,
                ),
                "AI sourcing and the selected real local file remain distinct",
              );
              ctx.assert(
                (await titles(ctx)).join("|") === "城市开场|产品演示",
                "Previewing does not change shot data",
              );
              ctx.assert(
                (await readFile(new URL("index.html", fixture), "utf8")) === originalComposition,
                "Previewing does not modify the video",
              );
            },
            screenshot: {
              name: "script-separated-materials",
              requireText: ["镜头", "素材", "音效", "city image #1.svg", "未保存修改"],
            },
          },
        );

        await ctx.prove("Saved plans survive reload with only a table, edit and preview entry", {
          voiceover: vo[3],
          action: async () => {
            await ctx.clickText("保存脚本");
            await ctx.waitFor(
              `document.querySelector('section[aria-label="脚本表"] [role="status"]')?.textContent.trim() === '已保存'`,
            );
            const disk = await readFile(script, "utf8");
            for (const field of [
              "music_prompt:",
              "music_asset:",
              "voice_id:",
              "voice_model:",
              "voice_name:",
              "visual_style:",
              "camera:",
              "asset_source:",
              "asset_kind:",
              "asset_brief:",
              "asset_reference:",
              "sound_effects:",
              "sound_effect_reference:",
              "voiceover:",
            ])
              ctx.assert(disk.includes(field), `Saved ${field}`);
            ctx.assert(disk.includes('theme: "editorial"'), "Theme intent persists in the canonical script");
            ctx.assert(disk.includes("component:spatial-camera-suite#depth-layer-moves"), "Saved camera references the actual spatial component recipe");
            ctx.assert(disk.includes('asset_source: "auto"') && disk.includes('asset_kind: "image"'), "AI source intent and concrete media type persist together");
            for (const field of ["template:", "align_to_template:"])
              ctx.assert(
                !disk.includes(field),
                `Shared theme selection does not duplicate host data in the script: ${field}`,
              );
            ctx.assert(!disk.includes("收尾号召"), "Deleted row is absent on disk");
            await reload(ctx);
            await ctx.waitFor(
              `document.querySelector(${JSON.stringify(label("镜头内容 1"))})?.value.startsWith('城市开场\\n')`,
            );
            await ctx.eval(
              `window.dispatchEvent(new MessageEvent('message', {source: window, data: {type: 'ipollowork:studio-host-context', projectId: 'storyboard-table-layout-eval', designSystem: {id: 'editorial', name: 'Editorial'}, designSystemThemes: [{id:'agentic', name:'Agentic', category:'Product'}, {id:'editorial', name:'Editorial', category:'Studio'}]}}))`,
            );
            await ctx.waitFor(`document.querySelector(${JSON.stringify(label("空间运镜编排 1"))})?.value === 'depth-layer-moves'`);
          },
          assert: async () => {
            ctx.assert(
              (await titles(ctx)).join("|") === "城市开场|产品演示",
              "Saved row titles survive reload",
            );
            ctx.assert(
              await ctx.eval(
                `document.querySelector(${JSON.stringify(label("旁白 1"))}).value === '从一个想法，到一支数字团队。'`,
              ),
              "Saved narration survives reload",
            );
            ctx.assert(
              await ctx.eval(
                `document.querySelector(${JSON.stringify(label("选择旁白声线 1"))})?.textContent.includes('龙安阳') && document.querySelector(${JSON.stringify(label("空间运镜编排 1"))}).value === 'depth-layer-moves'`,
              ),
              "Saved voice-library choice and spatial camera recipe stay attached to the shot",
            );
            ctx.assert(
              await ctx.eval(
                `document.querySelector(${JSON.stringify(label("全片配乐要求"))}).value.includes('电子氛围')`,
              ),
              "Saved whole-video music prompt survives reload",
            );
            ctx.assert(
              await ctx.eval(
                `document.querySelector(${JSON.stringify(label("选择视频主题"))}).value === 'editorial' && document.querySelector(${JSON.stringify(label("全片画面风格"))}).value.includes('纪录片')`,
              ),
              "Saved theme and overall visual style survive reload",
            );
            ctx.assert(
              await ctx.eval(
                `Array.from(document.querySelectorAll('[role="tab"]')).map(x=>x.textContent.trim()).join('|') === '脚本表|编辑|预览'`,
              ),
              "No board, review or source tabs",
            );
            ctx.assert(
              (await readFile(new URL("index.html", fixture), "utf8")) === originalComposition,
              "Saving script did not regenerate the video",
            );
          },
          screenshot: {
            name: "script-reloaded",
            requireText: ["脚本表", "2 个镜头"],
            rejectText: ["分镜板", "审阅", "源文件"],
          },
        });

        await ctx.prove("The script follows editor theme and locale without losing edits", {
          voiceover: vo[4],
          action: async () => {
            await ctx.eval(
              `window.postMessage({type:'ipollowork:studio-theme',theme:'dark'}, '*'); window.postMessage({type:'ipollowork:studio-locale',locale:'en'}, '*')`,
            );
            await ctx.waitForText("Script table");
          },
          assert: async () => {
            const state = await ctx.eval(
              `({theme: document.documentElement.dataset.ipolloworkTheme, language: document.documentElement.lang, color: getComputedStyle(document.querySelector('section[aria-label="Script table"]')).backgroundColor, title: document.querySelector('textarea[aria-label="Shot content 1"]').value.split("\\n")[0]})`,
            );
            ctx.assert(
              state.theme === "dark" && state.language === "en" && state.title === "城市开场",
              "Theme/locale changed without translating user content",
            );
            ctx.assert(
              state.color !== "rgb(255, 255, 255)" && state.color !== "rgba(0, 0, 0, 0)",
              "Script uses the dark semantic surface",
            );
          },
          screenshot: {
            name: "script-dark-en",
            requireText: ["Picture & scene", "Camera", "Materials", "Sound effects", "Save script"],
          },
        });
        await ctx.client.send("Emulation.setDeviceMetricsOverride", {
          width: 680,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await ctx.eval(
          `window.postMessage({type:'ipollowork:studio-theme',theme:'light'}, '*'); window.postMessage({type:'ipollowork:studio-locale',locale:'zh'}, '*')`,
        );
        await ctx.waitForText("脚本表");
        ctx.assert(
          await ctx.eval(
            `(() => {const el=document.querySelector('.hf-script-table-scroll'); return el.scrollWidth > el.clientWidth && document.documentElement.scrollWidth <= window.innerWidth;})()`,
          ),
          "Narrow editor scrolls the table without overflowing the shell",
        );
        await ctx.screenshot("script-narrow-light", {
          claim: "Narrow pane keeps the actions visible and the table scrollable",
          voiceover: vo[4],
          requireText: ["脚本表", "保存脚本"],
        });

        await ctx.prove(
          "Dashed column handles resize precisely and native scrolling reaches every field",
          {
            voiceover: vo[6],
            action: async () => {
              const browser = await puppeteer.connect({
                browserURL: ctx.cdpBaseUrl,
                defaultViewport: null,
              });
              try {
                const page = (await browser.pages()).find((page) =>
                  page.url().includes("storyboard-table-layout-eval"),
                );
                const selector = label("调整列宽: 画面与场景");
                const handle = await page.$(selector);
                const bounds = await handle.boundingBox();
                const widths = await page.$$eval("thead th", (cells) =>
                  cells.map((cell) => cell.getBoundingClientRect().width),
                );
                const playbackTime = new URLSearchParams(
                  new URL(page.url()).hash.split("?")[1],
                ).get("t");
                await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
                await page.mouse.down();
                await page.mouse.move(
                  bounds.x + bounds.width / 2 + 100,
                  bounds.y + bounds.height + 35,
                  { steps: 12 },
                );
                await page.mouse.up();
                await ctx.waitFor(
                  `Math.abs(document.querySelectorAll('thead th')[1].getBoundingClientRect().width - ${widths[1] + 100}) < 2`,
                );
                const resized = await page.$$eval("thead th", (cells) =>
                  cells.map((cell) => cell.getBoundingClientRect().width),
                );
                ctx.assert(
                  Math.abs(resized[2] - widths[2]) < 2,
                  "Dragging one column does not squeeze its neighbour",
                );
                await page.focus(selector);
                await page.keyboard.press("ArrowRight");
                await ctx.waitFor(
                  `Math.abs(document.querySelectorAll('thead th')[1].getBoundingClientRect().width - ${widths[1] + 116}) < 2`,
                );
                await page.keyboard.press("Home");
                await ctx.waitFor(
                  `Math.abs(document.querySelectorAll('thead th')[1].getBoundingClientRect().width - 300) < 2`,
                );
                // A long left drag stops at the minimum instead of collapsing the inputs.
                const resetBounds = await handle.boundingBox();
                await page.mouse.move(resetBounds.x + 4, resetBounds.y + 15);
                await page.mouse.down();
                await page.mouse.move(2, resetBounds.y + 15, { steps: 12 });
                await page.mouse.up();
                await ctx.waitFor(
                  `Math.abs(document.querySelectorAll('thead th')[1].getBoundingClientRect().width - 180) < 2`,
                );
                await page.click(selector, { count: 2 });
                await ctx.waitFor(
                  `Math.abs(document.querySelectorAll('thead th')[1].getBoundingClientRect().width - 300) < 2`,
                );
                ctx.assert(
                  new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("t") ===
                    playbackTime,
                  "Column arrow keys do not also move the hidden video playhead",
                );
                ctx.assert(
                  await page.$eval(
                    'section[aria-label="全片设置"] select[aria-label="选择视频主题"]',
                    (element) => element.isConnected,
                  ),
                  "All three global choices stay visible without an extra disclosure layer",
                );
                const scrollRegion = await page.$(".hf-script-table-scroll");
                const scrollBounds = await scrollRegion.boundingBox();
                ctx.assert(Boolean(scrollBounds), "Script scroll area is visible");
                await page.mouse.move(
                  scrollBounds.x + Math.min(scrollBounds.width / 2, 320),
                  scrollBounds.y + Math.min(scrollBounds.height / 2, 100),
                );
                await page.mouse.wheel({ deltaX: 2000, deltaY: 0 });
                await ctx.waitFor(
                  `document.querySelector('.hf-script-table-scroll').scrollLeft > 250`,
                );
                const last = await page.$eval(
                  'tr[data-shot="1"] td:last-child',
                  (cell) => cell.getBoundingClientRect().right,
                );
                ctx.assert(last <= 680, "Horizontal wheel reveals the last action column");
                await ctx.client.send("Emulation.setDeviceMetricsOverride", {
                  width: 680,
                  height: 430,
                  deviceScaleFactor: 1,
                  mobile: false,
                });
                await ctx.waitFor(
                  `document.querySelector('.hf-script-table-scroll').scrollHeight > document.querySelector('.hf-script-table-scroll').clientHeight`,
                );
                const narrowScrollRegion = await page.$(".hf-script-table-scroll");
                const narrowScrollBounds = await narrowScrollRegion.boundingBox();
                ctx.assert(Boolean(narrowScrollBounds), "Narrow script scroll area is visible");
                const scrollX = narrowScrollBounds.x + Math.min(narrowScrollBounds.width / 2, 320);
                const scrollY = narrowScrollBounds.y + Math.min(narrowScrollBounds.height / 2, 100);
                await page.mouse.move(scrollX, scrollY);
                await page.mouse.wheel({ deltaX: 0, deltaY: 500 });
                await ctx.waitFor(
                  `document.querySelector('.hf-script-table-scroll').scrollTop > 30`,
                );
                // Drag the real bottom scrollbar, not scrollLeft assignment.
                const scroll = await page.$eval(".hf-script-table-scroll", (el) => {
                  const box = el.getBoundingClientRect();
                  const thumbWidth = (el.clientWidth * el.clientWidth) / el.scrollWidth;
                  return {
                    x: box.x + (el.scrollLeft / el.scrollWidth) * el.clientWidth + thumbWidth / 2,
                    y: box.bottom - 5,
                    left: box.left + 2,
                  };
                });
                await page.mouse.move(scroll.x, scroll.y);
                await page.mouse.down();
                await page.mouse.move(scroll.left, scroll.y, { steps: 12 });
                await page.mouse.up();
                await ctx.waitFor(
                  `document.querySelector('.hf-script-table-scroll').scrollLeft < 2`,
                );
                await page.mouse.move(scrollX, scrollY);
                await page.mouse.wheel({ deltaX: 0, deltaY: -600 });
                await ctx.waitFor(
                  `document.querySelector('.hf-script-table-scroll').scrollTop === 0`,
                );
              } finally {
                browser.disconnect();
              }
              await ctx.client.send("Emulation.setDeviceMetricsOverride", {
                width: 680,
                height: 900,
                deviceScaleFactor: 1,
                mobile: false,
              });
            },
            assert: async () => {
              ctx.assert(
                await ctx.eval(
                  `getComputedStyle(document.querySelector('tr[data-shot="1"] td:nth-child(2)')).borderRightStyle === 'dashed'`,
                ),
                "Data fields use subtle dashed dividers",
              );
              ctx.assert(
                await ctx.eval(
                  `document.querySelector('.hf-script-table-scroll').scrollLeft === 0 && document.documentElement.scrollWidth <= window.innerWidth`,
                ),
                "Scroll stays contained in the table",
              );
              ctx.assert(
                (await titles(ctx)).join("|") === "城市开场|产品演示",
                "Layout gestures preserve shot contents and order",
              );
              ctx.assert(
                await ctx.eval(
                  `!document.querySelector('section [role="status"]').textContent.includes('未保存')`,
                ),
                "Resizing is not a script mutation",
              );
            },
            screenshot: {
              name: "script-resize-scroll",
              requireText: ["脚本表", "画面与场景", "保存脚本"],
            },
          },
        );
        await ctx.client.send("Emulation.clearDeviceMetricsOverride");

        await ctx.prove("Concurrent agent edits cannot silently overwrite the local draft", {
          voiceover: vo[5],
          action: async () => {
            await ctx.fill(label("旁白 1"), "我的未保存旁白");
            // Simulate a second author, not an editor action; the assertion witnesses the guard.
            await writeFile(
              script,
              `${await readFile(script, "utf8")}\n## Agent notes\nConcurrent edit kept.\n`,
            );
            await ctx.waitForText("脚本已被其他操作修改", {
              timeoutMs: 30000,
            });
          },
          assert: async () => {
            ctx.assert(
              await ctx.eval(
                `document.querySelector(${JSON.stringify(label("旁白 1"))}).value === '我的未保存旁白'`,
              ),
              "Local edits remain available",
            );
            ctx.assert(
              await ctx.eval(
                `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('保存脚本')).disabled`,
              ),
              "Saving is blocked until conflict is resolved",
            );
            ctx.assert(
              (await readFile(script, "utf8")).includes("Concurrent edit kept."),
              "Other author's change is preserved",
            );
          },
          screenshot: {
            name: "script-conflict",
            requireText: ["脚本已被其他操作修改", "未保存修改"],
          },
        });
      },
    },
  ],
};
