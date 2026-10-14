import { copyFile, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const project = join(root, ".ipollowork-dev/canvas-drag-project");
const fixture = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Canvas Selection and Drag</title><style>
*{box-sizing:border-box}body{margin:0;font:32px Arial;color:#242424}main{width:1280px;height:720px;background:#f4f2ed;position:relative}.card{position:absolute;width:360px;height:180px;border-radius:24px;padding:32px}.card span{display:block;font-size:24px;margin-top:20px}#first-card{left:100px;top:100px;background:#a9d8d6}#second-card{left:660px;top:100px;background:#d7c4eb}#animated-card{left:120px;top:440px;background:#f4db9f}
</style><script src="assets/gsap.min.js"></script></head><body><main id="root" data-composition-id="main" data-start="0" data-duration="12" data-width="1280" data-height="720"><div class="card" id="first-card" data-label="First Card">First card<span id="first-caption">Click and drag me</span></div><div class="card" id="second-card" data-label="Second Card">Second card<span id="second-caption">Quick selection</span></div><div class="card" id="animated-card" data-label="Animated Card">Animated card</div></main><script>const tl = gsap.timeline({ paused: true }); tl.to("#animated-card", { x: 180, duration: 12, ease: "none" }, 0); window.__timelines = { main: tl };</script></body></html>`;
const frameExpression = `[...document.querySelectorAll('hyperframes-player')].filter(h=>getComputedStyle(h.parentElement.parentElement).opacity!=='0').map(h=>h.shadowRoot?.querySelector('iframe')).find(f=>f?.contentDocument?.getElementById('first-card'))`;

export default {
  id: "preview-canvas-drag", title: "Canvas selection, release-only saving and durable drag positions",
  kind: "user-facing", preserveTheme: true, cdpTarget: { urlIncludes: ":5539" },
  steps: [{ name: "Select, drag, save and reopen", run: async ctx => {
    await mkdir(join(project, "assets"), { recursive: true });
    await copyFile(join(root, "vendor/hyperframes/packages/studio/node_modules/gsap/dist/gsap.min.js"), join(project, "assets/gsap.min.js"));
    await writeFile(join(project, "index.html"), fixture);
    await writeFile(join(project, "hyperframes.json"), JSON.stringify({ paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }));
    const registrations = join(root, "vendor/hyperframes/packages/studio/data/projects");
    await mkdir(registrations, { recursive: true });
    const registration = join(registrations, "canvas-drag-proof");
    try { await symlink(project, registration, "junction"); }
    catch (error) { if (error.code !== "EEXIST" || await realpath(registration) !== await realpath(project)) throw error; }
    const require = createRequire(join(root, "vendor/hyperframes/packages/cli/package.json"));
    const { default: puppeteer } = await import(pathToFileURL(require.resolve("puppeteer-core")).href);
    const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9947", defaultViewport: null });
    const page = (await browser.pages()).find(page => page.url().includes(":5539"));
    const pending = [], writes = [], probes = [];
    const isWrite = request => request.method() === "POST" && request.url().includes("/gsap-mutations");
    const onRequest = request => {
      if (request.url().includes("/probe-element/")) probes.push(request.url());
      if (isWrite(request)) { writes.push(request.postData()); pending.push(request); }
      else void request.continue();
    };
    const waitForWrite = async () => { if (!pending.length) await page.waitForRequest(isWrite); };
    const ready = async () => {
      await page.waitForFunction(`Boolean(${frameExpression}) && [...document.querySelectorAll('hyperframes-player')].every(h=>{const l=h.shadowRoot?.querySelector('.hfp-shader-loader');return !l || getComputedStyle(l).visibility==='hidden'})`, { timeout: 45_000 });
      await page.evaluate(() => window.postMessage({ type: "ipollowork:studio-theme", theme: "light" }, "*"));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const point = (id, x = 20, y = 20) => page.evaluate(({ expression, id, x, y }) => {
      const f = new Function(`return ${expression}`)();
      const r = f.contentDocument.getElementById(id).getBoundingClientRect(), b = f.getBoundingClientRect();
      return { x: b.left + (r.left + x) * b.width / f.contentWindow.innerWidth, y: b.top + (r.top + y) * b.height / f.contentWindow.innerHeight };
    }, { expression: frameExpression, id, x, y });
    const position = id => page.evaluate(({ expression, id }) => {
      const f = new Function(`return ${expression}`)();
      const r = f.contentDocument.getElementById(id).getBoundingClientRect();
      return { x: r.x, y: r.y };
    }, { expression: frameExpression, id });
    const selected = async id => {
      try { await page.waitForFunction(id => new URLSearchParams(location.hash.split("?")[1]).get("selId") === id, { timeout: 5000 }, id); }
      catch { throw new Error(`Click did not select ${id}: ${await page.evaluate(() => location.hash)}`); }
    };
    const samePosition = (before, after) => Math.abs(before.x - after.x) < 1 && Math.abs(before.y - after.y) < 1;
    const savePausedWrite = async () => {
      const request = pending.shift(); ctx.assert(request, "The release started a save");
      const response = page.waitForResponse(response => response.request() === request);
      await request.continue();
      ctx.assert((await response).ok(), "The position mutation was saved successfully");
      await page.waitForFunction(() => !document.querySelector('[data-canvas-save-state="saving"]'), { timeout: 45_000 });
      await ready();
    };
    let dropped, animatedDropped;
    try {
      await page.setCacheEnabled(false);
      await page.goto("http://127.0.0.1:5539/#project/canvas-drag-proof?ipolloworkTheme=light");
      await page.reload({ waitUntil: "domcontentloaded" });
      await ready();
      await page.setRequestInterception(true);
      page.on("request", onRequest);
      await ctx.prove("One press selects and drags immediately; tiny movements and held drags do not save", {
        voiceover: "左键可以直接选中元素，第一次按下就能拖动。轻微抖动不会保存，按住鼠标拖动时也不会出现保存提示。",
        action: async () => {
          for (const id of ["first-caption", "second-card"]) {
            const p = await point(id); await page.mouse.click(p.x, p.y); await selected(id);
          }
          const blank = await point("root", 1150, 650); await page.mouse.click(blank.x, blank.y);
          await page.waitForFunction(() => !new URLSearchParams(location.hash.split("?")[1]).get("selId"));
          const jitter = await point("second-card"); const before = await position("second-card");
          await page.mouse.move(jitter.x, jitter.y); await page.mouse.down(); await page.mouse.move(jitter.x + 2, jitter.y + 1); await page.mouse.up();
          ctx.assert(samePosition(before, await position("second-card")) && writes.length === 0, "A tiny movement stays a selection click");
          const p = await point("first-card"); await page.mouse.move(p.x, p.y); await page.mouse.down();
          await page.mouse.move(p.x + 90, p.y + 45, { steps: 18 });
          dropped = await position("first-card");
        },
        assert: async () => {
          ctx.assert(dropped.x > 200 && dropped.y > 140, "The first press really moved the element");
          ctx.assert(writes.length === 0 && probes.length === 0, "Dragging and selecting do not write or wait for source probes");
          ctx.assert(!await page.$('[data-canvas-save-state="saving"]'), "Saving appears only after release");
          ctx.output("Before release", JSON.stringify({ dropped, positionWrites: writes.length, sourceProbes: probes.length }));
          await ready();
        }, screenshot: { name: "live-drag-no-save", requireText: ["Layers"], rejectText: ["Saving...", "Failed to save"] },
      });
      await ctx.prove("Releasing saves exactly once and keeps the dropped position during a slow save", {
        voiceover: "松开鼠标后才显示保存中。即使保存较慢，元素也留在松手的位置，不会跳回去或重复提交。",
        action: async () => {
          await page.mouse.up();
          await page.waitForFunction(() => Boolean(document.querySelector('[data-canvas-save-state="saving"]')));
          await waitForWrite();
        },
        assert: async () => {
          ctx.assert(writes.length === 1 && pending.length === 1, "One drag produces one pending save");
          ctx.assert(samePosition(dropped, await position("first-card")), "A pending save retains the release position");
          const p = await point("first-card"); await page.mouse.move(p.x, p.y); await page.mouse.down();
          await page.mouse.move(p.x + 40, p.y + 20, { steps: 6 }); await page.mouse.up();
          ctx.assert(writes.length === 1 && samePosition(dropped, await position("first-card")), "A pending save cannot be overlapped by a second drag");
          await ready();
        }, screenshot: { name: "saving-after-release", requireText: ["Saving..."], rejectText: ["Failed to save"] },
      });
      await ctx.prove("Static and animated layers stay at the saved position after loading, seeking and reopening", {
        voiceover: "保存完成后，普通元素和动画元素都保持拖拽结果。拖动播放进度或重新打开工作台，位置也不会恢复到原来。",
        action: async () => {
          await savePausedWrite();
          ctx.assert(samePosition(dropped, await position("first-card")), "The completed static save retains the final pixels");
          const p = await point("animated-card"); await page.mouse.move(p.x, p.y); await page.mouse.down();
          await page.mouse.move(p.x + 65, p.y - 35, { steps: 15 }); animatedDropped = await position("animated-card");
          await page.mouse.up(); await waitForWrite(); await savePausedWrite();
          ctx.assert(samePosition(animatedDropped, await position("animated-card")), "The animation save retains the final pixels");
          await page.reload({ waitUntil: "domcontentloaded" }); await ready();
          await page.evaluate(expression => { const f = new Function(`return ${expression}`)(); f.contentWindow.__player.seek(3); f.contentWindow.__player.seek(0); }, frameExpression);
        },
        assert: async () => {
          ctx.assert(writes.length === 2, "Each complete drag writes exactly once");
          ctx.assert(samePosition(dropped, await position("first-card")), "Static position survives reopening");
          ctx.assert(samePosition(animatedDropped, await position("animated-card")), "Animation position survives reopening and seeking");
          const source = await readFile(join(project, "index.html"), "utf8");
          ctx.assert(source.includes('gsap.set("#first-card"'), "The source contains the saved static position");
          ctx.output("Saved and reopened", JSON.stringify({ static: await position("first-card"), animated: await position("animated-card"), positionWrites: writes.length }));
          await ready();
        }, screenshot: { name: "positions-after-reopening", requireText: ["Layers"], rejectText: ["Saving...", "Failed to save"] },
      });
    } finally {
      await page.mouse.up().catch(() => {});
      for (const request of pending) await request.continue().catch(() => {});
      page.off("request", onRequest);
      await page.setRequestInterception(false);
      await browser.disconnect();
    }
  } }],
};
