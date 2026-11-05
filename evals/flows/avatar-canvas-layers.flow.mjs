// Run against an isolated Studio project with a real transparent avatar asset.
// IPOLLOWORK_AVATAR_PROOF_DIR identifies that scratch project's directory.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export default {
  id: "avatar-canvas-layers", title: "透明数字人拖拽、层级和持久化", kind: "user-facing", preserveTheme: true,
  cdpTarget: { urlIncludes: "3566" },
  steps: [{ name: "Place and arrange a transparent avatar", run: async ctx => {
    const project = process.env.IPOLLOWORK_AVATAR_PROOF_DIR;
    ctx.assert(project, "Provide an isolated project directory");
    const require = createRequire(resolve(process.cwd(), "vendor/hyperframes/packages/cli/package.json"));
    const { default: puppeteer } = await import(pathToFileURL(require.resolve("puppeteer-core")).href);
    const browser = await puppeteer.connect({ browserURL: "http://localhost:9828", defaultViewport: null });
    const page = (await browser.pages()).find(page => page.url().includes("3566"));
    const id = "avatar-transparent-cab792e8";
    const source = () => readFile(resolve(project, "index.html"), "utf8");
    const preview = () => page.frames().find(frame => frame.url().includes("/preview?"));
    const ready = async () => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        for (const frame of page.frames()) {
          if (frame.url().includes('/preview?') && await frame.evaluate(id => document.getElementById(id)?.readyState >= 2, id).catch(() => false)) return frame;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('The avatar preview did not become ready');
    };
    const menu = async text => {
      const button = (await page.evaluateHandle(text => [...document.querySelectorAll("button")].find(e => e.innerText === text), text)).asElement();
      ctx.assert(button, `Menu contains ${text}`);
      await button.click();
    };
    const fileHas = async expression => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (await page.evaluate(({ content, expression }) => new Function('content', `return ${expression}`)(content), { content: await source(), expression })) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Saved source did not satisfy: ${expression}`);
    };
    try {
      await page.setCacheEnabled(false);
      await page.goto("http://localhost:3566/?locale=zh#project/avatar-layer-proof?tab=assets&rc=0", { waitUntil: "domcontentloaded" });
      await page.setViewport({ width: 1440, height: 1000 });
      await page.waitForFunction(() => [...document.querySelectorAll("button")].some(e => e.innerText === "属性"));
      if (!await page.evaluate(() => [...document.querySelectorAll("button")].some(e => e.innerText === "素材"))) {
        const properties = (await page.evaluateHandle(() => [...document.querySelectorAll("button")].find(e => e.innerText === "属性"))).asElement();
        await properties.click();
      }
      await page.waitForFunction(() => [...document.querySelectorAll("button")].some(e => e.innerText === "素材"));
      const assets = (await page.evaluateHandle(() => [...document.querySelectorAll("button")].find(e => e.innerText === "素材"))).asElement();
      await assets.click();
      await page.waitForFunction(() => [...document.querySelectorAll("button")].some(e => /^(Video|视频)\s*\d+$/.test(e.innerText)));
      const section = (await page.evaluateHandle(() => [...document.querySelectorAll("button")].find(e => /^(Video|视频)\s*\d+$/.test(e.innerText)))).asElement();
      if (await section.evaluate(e => e.getAttribute("aria-expanded") === "false")) await section.click();
      await page.waitForFunction(id => [...document.querySelectorAll('[draggable="true"]')].some(e => e.innerText.includes(id)), {}, id);
      await ctx.prove("Transparent avatar drops onto the canvas and can be moved without save errors", {
        voiceover: "把透明数字人从素材库拖入画布，人物保持原有比例，移动后也能正常保存。",
        action: async () => {
          const card = (await page.evaluateHandle(id => [...document.querySelectorAll('[draggable="true"]')].find(e => e.innerText.includes(id)), id)).asElement();
          await page.setDragInterception(true);
          await card.dragAndDrop(await page.$('[data-testid="preview-zoom-stage"]'), { delay: 250 });
          await page.setDragInterception(false);
          await fileHas(`content.includes('id="${id}"')`);
          await ready();
          await page.waitForFunction(() => document.querySelector('[data-testid="preview-zoom-stage"]')?.getBoundingClientRect().width > 100);
          const box = await (await page.$('[data-testid="preview-zoom-stage"]')).boundingBox();
          const x = box.x + box.width / 2, y = box.y + box.height / 2;
          await page.mouse.click(x, y);
          await page.waitForFunction(id => location.hash.includes(`selId=${id}`), {}, id);
          await page.mouse.move(x, y); await page.mouse.down();
          await page.mouse.move(x + 60, y + 20, { steps: 20 }); await page.mouse.up();
          await fileHas(`content.includes('gsap.set("#${id}"')`);
        },
        assert: async () => {
          const html = await source();
          ctx.assert(html.includes('width: 576px') && html.includes('height: 1024px'), "The portrait keeps its natural geometry");
          ctx.assert(html.split(`gsap.set("#${id}"`).length === 2, "The saved move is authored exactly once outside the template loop");
          const alpha = await preview().evaluate(id => {
            const video = document.getElementById(id), canvas = document.createElement("canvas");
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            const context = canvas.getContext("2d"); context.drawImage(video, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let clear = 0, solid = 0;
            for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] < 10) clear++; if (pixels[i] > 245) solid++; }
            return { clear, solid };
          }, id);
          ctx.assert(alpha.clear > 1000 && alpha.solid > 1000, "Browser decodes both transparent background and opaque person pixels");
        },
        screenshot: { name: "avatar-moved-transparent", rejectText: ["Failed to save animated edit", "status 500"] },
      });
      await ctx.prove("Low layer stays above the background and below all content", {
        voiceover: "选择低层级后，人物在背景上方，字幕和其他内容显示在人物上面。",
        action: async () => {
          const box = await (await page.$('[data-testid="preview-zoom-stage"]')).boundingBox();
          await page.mouse.click(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { button: "right" });
          await menu("低层级 · 仅在背景之上");
          await fileHas(`new DOMParser().parseFromString(content,'text/html').getElementById('${id}').style.zIndex === '1'`);
        },
        assert: async () => {
          const ok = await preview().evaluate(id => {
            const person = document.getElementById(id);
            return [...person.parentElement.children].filter(e => e !== person && !['AUDIO','SCRIPT','STYLE'].includes(e.tagName)).every(e => Number(getComputedStyle(e).zIndex) > Number(person.style.zIndex));
          }, id);
          ctx.assert(ok, "Every content sibling paints above the person; the composition background remains below it");
        },
        screenshot: { name: "avatar-low-layer" },
      });
      await ctx.prove("High layer and moved position survive reopening", {
        voiceover: "在时间线上右键人物，切换为高层级，就能盖住其他内容；重新打开后位置和层级都会保留。",
        action: async () => {
          const card = (await page.evaluateHandle(id => [...document.querySelectorAll('[draggable="true"]')].find(e => e.innerText.includes(id)), id)).asElement();
          await card.click();
          await page.waitForFunction(() => [...document.querySelectorAll('.hf-timeline-clip-content__label')].some(e => e.textContent.startsWith('Avatar Transparent')));
          const clip = (await page.evaluateHandle(() => [...document.querySelectorAll('.hf-timeline-clip-content__label')].find(e => e.textContent.startsWith('Avatar Transparent')))).asElement();
          await clip.click({ button: "right" });
          await menu("高层级 · 盖住其他元素");
          await fileHas(`Number(new DOMParser().parseFromString(content,'text/html').getElementById('${id}').style.zIndex) > 1`);
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForFunction(() => document.querySelector('[data-testid="preview-zoom-stage"]')?.getBoundingClientRect().width > 100);
          await ctx.waitFor(`Boolean(document.querySelector('.hf-timeline-clip-content__label'))`);
          await ready();
        },
        assert: async () => {
          const html = await source();
          ctx.assert(html.includes(`gsap.set("#${id}"`), "Moving the avatar is durable");
          const high = await preview().evaluate(id => {
            const person = document.getElementById(id);
            return Boolean(person && Number(person.style.zIndex) > Math.max(...[...person.parentElement.children].filter(e => e !== person && !['AUDIO','SCRIPT','STYLE'].includes(e.tagName)).map(e => Number(getComputedStyle(e).zIndex) || 0)));
          }, id);
          ctx.assert(high, "The reopened person paints above all content siblings");
        },
        screenshot: { name: "avatar-high-layer-reopened", rejectText: ["Failed to save animated edit"] },
      });
    } finally { await browser.disconnect(); }
  } }],
};
