import { readFile, writeFile, mkdir, copyFile, symlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
const vo = await loadVoiceoverParagraphs("video-editing-phase-one");
const project = fileURLToPath(
  new URL("../results/video-editing-phase-one-fixture/workspace/", import.meta.url),
);
const studioUrl =
  process.env.IPW_PHASE_ONE_STUDIO_URL ||
  "http://127.0.0.1:5191/#project/video-editing-phase-one?v=1&t=4&tab=design&locale=en&ipolloworkTheme=light";
const masterSource =
  '<!doctype html><html><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script><style>html,body{margin:0;width:1280px;height:720px;background:#ece7dc} .clip{position:absolute;inset:0}</style></head><body><main data-composition-id="main" data-duration="16" data-width="1280" data-height="720" data-fps="30"><section id="scene-one" class="clip" data-hf-id="scene-one" data-label="Scene One" data-start="2" data-duration="8" data-track-index="0" data-composition-id="scene-one" data-composition-src="compositions/scene-one.html"></section><section id="closing" class="clip" data-hf-id="closing" data-label="Closing" data-start="12" data-duration="4" data-track-index="3" style="display:grid;place-items:center;font:80px Arial">Closing</section></main><script>const tl=gsap.timeline({paused:true});tl.to({}, {duration:16});window.__timelines=window.__timelines||{};window.__timelines["main"]=tl;</script></body></html>';
const sceneSource =
  '<!doctype html><html><head><meta charset="utf-8"><script src="../assets/gsap.min.js"></script><style>html,body{margin:0;width:1280px;height:720px;background:#ece7dc}#title{position:absolute;left:160px;top:210px;font:72px Arial;color:#252525}#subtitle{position:absolute;left:160px;top:360px;font:32px Arial;color:#555}</style></head><body><main data-composition-id="scene-one" data-duration="8" data-width="1280" data-height="720" data-fps="30"><h1 id="title" class="clip" data-hf-id="title" data-label="Title" data-start="1" data-duration="5" data-track-index="0">Editable title</h1><p id="subtitle" class="clip" data-hf-id="subtitle" data-label="Subtitle" data-start="0" data-duration="8" data-track-index="1">Position and opacity stay independent</p></main><script>const tl=gsap.timeline({paused:true});tl.to("#title",{keyframes:{"0%":{x:0,scale:1,rotation:0,opacity:0},"100%":{x:100,scale:1.15,rotation:15,opacity:1}},duration:1,ease:"none"},1);tl.to("#title",{x:200,duration:2,ease:"power1.inOut"},3);window.__timelines=window.__timelines||{};window.__timelines["scene-one"]=tl;</script></body></html>';
const scene = '[data-el-id="index.html#scene-one"]';
const title = '[data-el-id="compositions/scene-one.html#title"]';
const frame = `(() => {const hosts=[...document.querySelectorAll('hyperframes-player')];return hosts.find(h=>{const f=h.shadowRoot?.querySelector('iframe');return f && f.style.visibility!=='hidden' && getComputedStyle(h).opacity!=='0'})?.shadowRoot?.querySelector('iframe')})()`;
async function ready(ctx) {
  await ctx.waitFor(
    `!!${frame}?.contentWindow?.__player && [...document.querySelectorAll('hyperframes-player')].every(h=>!h.hasAttribute('assets-loading') && !h.shadowRoot?.querySelector('.hfp-shader-loader.hfp-visible,.hfp-shader-loader.hfp-hiding')) && !document.querySelector('[data-testid="timeline-loading-disabled-overlay"]')`,
    { timeoutMs: 30000 },
  );
}
const scripts = (source) =>
  [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
async function rect(ctx, selector) {
  const result = await ctx.eval(
    `(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,start:Number(e.dataset.clipStart),end:Number(e.dataset.clipEnd)}})()`,
  );
  ctx.assert(result, `Missing ${selector}`);
  return result;
}
async function mouse(ctx, type, x, y, clickCount = 1) {
  await ctx.client.send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: "left",
    buttons: type === "mouseReleased" ? 0 : 1,
    clickCount,
  });
}
async function drag(ctx, selector, seconds, edge) {
  const r = await rect(ctx, selector);
  const pps = r.width / (r.end - r.start);
  const x = edge === "start" ? r.x + 5 : edge === "end" ? r.x + r.width - 5 : r.x + r.width / 2;
  const y = r.y + r.height / 2;
  await mouse(ctx, "mouseMoved", x, y);
  await new Promise((r) => setTimeout(r, 100));
  await mouse(ctx, "mousePressed", x, y);
  for (let i = 1; i <= 8; i++) await mouse(ctx, "mouseMoved", x + (seconds * pps * i) / 8, y);
  await mouse(ctx, "mouseReleased", x + seconds * pps, y);
}
async function seek(ctx, time, duration) {
  const r = await rect(ctx, '[role="slider"][aria-label="Seek"]');
  const x = r.x + (r.width * time) / duration,
    y = r.y + r.height / 2;
  await mouse(ctx, "mousePressed", x, y);
  await mouse(ctx, "mouseReleased", x, y);
  await ctx.waitFor(`Math.abs((${frame}?.contentWindow?.__player?.getTime()??-100)-${time})<0.06`, {
    timeoutMs: 15000,
  });
}
async function doubleClick(ctx, selector) {
  const r = await rect(ctx, selector);
  await mouse(ctx, "mousePressed", r.x + r.width / 2, r.y + r.height / 2, 2);
  await mouse(ctx, "mouseReleased", r.x + r.width / 2, r.y + r.height / 2, 2);
}
async function witness(ctx, sourcePath, condition, predicate = () => true) {
  await ctx.waitFor(condition, { timeoutMs: 15000 });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const source = await readFile(project + sourcePath, "utf8");
    if (predicate(source)) {
      await ready(ctx);
      return source;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Saved source did not converge: " + sourcePath);
}
let sceneAfterProperty, sceneAfterTrim, sceneAfterStretch, positionBefore;
async function position(ctx) {
  return ctx.eval(
    `(() => {const f=${frame};const e=f?.contentDocument.querySelector('[data-hf-id="title"]');return e ? ['x','scale','rotation'].map(p=>Number(f.contentWindow.gsap.getProperty(e,p))) : null})()`,
  );
}
export default {
  id: "video-editing-phase-one",
  title: "总时间轴剪辑与场景属性动画保持原作品效果",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "127.0.0.1:5191" },
  precondition: async (ctx) => {
    await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false });
    await mkdir(project + "compositions", { recursive: true });
    await mkdir(project + "assets", { recursive: true });
    await copyFile(
      fileURLToPath(
        new URL(
          "../../vendor/hyperframes/packages/studio/node_modules/gsap/dist/gsap.min.js",
          import.meta.url,
        ),
      ),
      project + "assets/gsap.min.js",
    );
    await writeFile(
      project + "hyperframes.json",
      JSON.stringify({
        paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
      }),
    );
    const dataDir = fileURLToPath(
      new URL("../../vendor/hyperframes/packages/studio/data/projects/", import.meta.url),
    );
    await mkdir(dataDir, { recursive: true });
    await symlink(project, dataDir + "video-editing-phase-one").catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    await writeFile(project + "index.html", masterSource);
    await writeFile(project + "compositions/scene-one.html", sceneSource);
    await ctx.client.send("Page.navigate", { url: "about:blank" });
    await ctx.client.send("Page.navigate", { url: studioUrl });
    await ctx.waitFor(
      `document.querySelector(${JSON.stringify(scene)}) && ${frame}?.contentWindow?.__player`,
      { timeoutMs: 60000 },
    );
    await ready(ctx);
    const snap = await ctx.eval(
      `document.querySelector('button[aria-label="Toggle snapping"]')?.title`,
    );
    if (snap === "Snapping enabled") await ctx.trustedClick('button[aria-label="Toggle snapping"]');
    return null;
  },
  steps: [
    {
      name: "Move scene without retiming",
      run: async (ctx) =>
        ctx.prove("Moving a scene preserves its animation and unrelated track", {
          voiceover: vo[0],
          action: async () => drag(ctx, scene, 1),
          assert: async () => {
            const source = await witness(
              ctx,
              "index.html",
              `Number(document.querySelector(${JSON.stringify(scene)})?.dataset.clipStart)===3`,
              (s) => /data-start="3"/.test(s),
            );
            ctx.assert(/data-start="3"/.test(source), "Scene moved to 3 seconds");
            ctx.assert(
              scripts(await readFile(project + "compositions/scene-one.html", "utf8")) ===
                scripts(sceneSource),
              "Scene animations unchanged",
            );
            ctx.assert(
              await ctx.eval(
                `document.querySelector('[data-layer-dom-id="closing"]')?.innerText.includes('Track 4')`,
              ),
              "Closing stays on track 3",
            );
          },
          screenshot: {
            name: "master-stable-tracks",
            requireText: ["Total timeline", "Scene One", "Closing"],
            rejectText: ["Something went wrong"],
          },
        }),
    },
    {
      name: "Trim scene without speed change",
      run: async (ctx) =>
        ctx.prove("Scene trim changes its in-point while preserving animation speed", {
          voiceover: vo[1],
          action: async () => drag(ctx, scene, 1, "start"),
          assert: async () => {
            const source = await witness(
              ctx,
              "index.html",
              `Number(document.querySelector(${JSON.stringify(scene)})?.dataset.clipStart)===4`,
              (s) => /data-playback-start="1"/.test(s),
            );
            ctx.assert(
              /data-playback-start="1"/.test(source),
              "Scene in-point advances one second",
            );
            ctx.assert(
              !/data-playback-rate="(?!1")/.test(source),
              "Trim does not alter playback rate",
            );
            ctx.assert(
              scripts(await readFile(project + "compositions/scene-one.html", "utf8")) ===
                scripts(sceneSource),
              "Trim preserves exact child animation script",
            );
          },
          screenshot: { name: "scene-trim-in-point", requireText: ["Total timeline", "Scene One"] },
        }),
    },
    {
      name: "Enter scene at matching frame",
      run: async (ctx) =>
        ctx.prove("Scene navigation accounts for trim offset", {
          voiceover: vo[2],
          action: async () => doubleClick(ctx, scene),
          assert: async () => {
            await ctx.waitFor(
              `Boolean(document.querySelector(${JSON.stringify(title)})) && document.body.innerText.includes('Scene editing')`,
              { timeoutMs: 30000 },
            );
            await ctx.waitFor(
              `${frame}?.src.includes('/preview/comp/') && Math.abs((${frame}?.contentWindow?.__player?.getTime() ?? -100)-1)<0.1`,
              { timeoutMs: 15000 },
            );
            await ready(ctx);
            const t = await ctx.eval(`${frame}?.contentWindow?.__player?.getTime()`);
            ctx.assert(Math.abs(t - 1) < 0.1, `Scene time ${t} includes trimmed in-point`);
          },
          screenshot: {
            name: "scene-local-time",
            requireText: ["Scene editing", "Title", "Subtitle"],
          },
        }),
    },
    {
      name: "Select layer and inspect properties",
      run: async (ctx) =>
        ctx.prove("Layer selection synchronizes the scene inspector", {
          voiceover: vo[3],
          action: async () => {
            await ctx.trustedClick(title);
            const r = await rect(ctx, '[role="separator"][aria-label="Resize rows"]');
            await mouse(ctx, "mousePressed", r.x + r.width / 2, r.y + r.height / 2);
            await mouse(ctx, "mouseMoved", r.x + r.width / 2, 280);
            await mouse(ctx, "mouseReleased", r.x + r.width / 2, 280);
            await ctx.trustedClick('button[aria-label="Expand Title"]');
            await ctx.waitFor(`!!document.querySelector('[data-timeline-property="opacity"]')`);
            await ctx.trustedClick('button[aria-label="Collapse Title"]');
            await ctx.trustedClick('button[aria-label="Expand Title"]');
          },
          assert: async () => {
            await ctx.waitFor(`!!document.querySelector('[data-timeline-property="opacity"]')`, {
              timeoutMs: 15000,
            });
            ctx.assert(
              scripts(await readFile(project + "compositions/scene-one.html", "utf8")) ===
                scripts(sceneSource),
              "Expanding and collapsing never rewrites existing motion",
            );
            ctx.assert(
              await ctx.eval(
                `Boolean(document.querySelector(${JSON.stringify(title + ".is-selected")}))`,
              ),
              "Selected layer is title",
            );
          },
          screenshot: { name: "selected-layer-properties", requireText: ["Title", "Opacity"] },
        }),
    },
    {
      name: "Edit properties independently",
      run: async (ctx) =>
        ctx.prove("Position and opacity keyframes can be edited independently", {
          voiceover: vo[4],
          action: async () => {
            await seek(ctx, 1.5, 8);
            positionBefore = await position(ctx);
            await ctx.trustedClick('[data-timeline-property="opacity"] [data-keyframe-time="2"]');
            const selector =
              '[data-timeline-property="opacity"] input[aria-label="opacity keyframe value at 100%"]';
            await ctx.trustedClick(selector);
            await ctx.fill(selector, "80");
            await ctx.client.send("Input.dispatchKeyEvent", {
              type: "keyDown",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
            });
            await ctx.client.send("Input.dispatchKeyEvent", {
              type: "keyUp",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
            });
          },
          assert: async () => {
            sceneAfterProperty = await witness(
              ctx,
              "compositions/scene-one.html",
              `!!document.querySelector('[data-timeline-property="opacity"]')`,
              (s) => /opacity: 0.8|opacity:0.8/.test(s),
            );
            const point = '[data-timeline-property="opacity"] [data-keyframe-time="2"]';
            const pr = await rect(ctx, point),
              clip = await rect(ctx, title);
            const pps = clip.width / (clip.end - clip.start);
            await mouse(ctx, "mousePressed", pr.x + pr.width / 2, pr.y + pr.height / 2);
            await mouse(ctx, "mouseMoved", pr.x + pr.width / 2 - 0.2 * pps, pr.y + pr.height / 2);
            await mouse(
              ctx,
              "mouseReleased",
              pr.x + pr.width / 2 - 0.2 * pps,
              pr.y + pr.height / 2,
            );
            sceneAfterProperty = await witness(
              ctx,
              "compositions/scene-one.html",
              `[...document.querySelectorAll('[data-timeline-property="opacity"] [data-keyframe-time]')].some(e=>Math.abs(Number(e.dataset.keyframeTime)-1.8)<0.001)`,
              (s) => /duration:\s*0.8/.test(s),
            );
            await seek(ctx, 1.5, 8);
            await ctx.trustedClick('button[aria-label="opacity add keyframe at playhead"]');
            await witness(
              ctx,
              "compositions/scene-one.html",
              `document.querySelectorAll('[data-timeline-property="opacity"] [data-keyframe-time]').length===3`,
              (s) => /"62.5%"/.test(s),
            );
            await ctx.trustedClick('[data-timeline-property="opacity"] [data-keyframe-time="1.5"]');
            await ctx.trustedClick('button[aria-label="opacity delete selected keyframe"]');
            sceneAfterProperty = await witness(
              ctx,
              "compositions/scene-one.html",
              `document.querySelectorAll('[data-timeline-property="opacity"] [data-keyframe-time]').length===2`,
              (s) => !/"62.5%"/.test(s),
            );
            await ctx.trustedClick('[data-timeline-property="opacity"] [data-keyframe-time="1.8"]');
            await seek(ctx, 1.5, 8);

            const beforeStatic = sceneAfterProperty;
            await ctx.trustedClick('[data-layer-dom-id="title"] button[aria-label="Add property"]');
            await ctx.trustedClick('[data-timeline-reveal-property="y"]');
            await ctx.trustedClick('button[aria-label="y add keyframe at playhead"]');
            await witness(
              ctx,
              "compositions/scene-one.html",
              `document.querySelectorAll('[data-timeline-property="y"] [data-keyframe-time]').length===1`,
              (s) => /y:\s*0/.test(s),
            );
            const staticPosition = await position(ctx);
            ctx.assert(
              staticPosition.every((value, i) => Math.abs(value - positionBefore[i]) < 0.01),
              "Adding a static channel preserves other runtime values",
            );
            await ctx.trustedClick('[data-timeline-property="y"] [data-keyframe-time="1.5"]');
            const yInput = '[data-timeline-property="y"] input[aria-label^="y keyframe value"]';
            await ctx.trustedClick(yInput);
            await ctx.fill(yInput, "30");
            await ctx.client.send("Input.dispatchKeyEvent", {
              type: "keyDown",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
            });
            await ctx.client.send("Input.dispatchKeyEvent", {
              type: "keyUp",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
            });
            await witness(
              ctx,
              "compositions/scene-one.html",
              `Number(document.querySelector('${yInput}')?.value)===30`,
              (s) => /y:\s*30/.test(s),
            );
            await ctx.trustedClick('button[aria-label="Undo"]');
            await witness(
              ctx,
              "compositions/scene-one.html",
              `Number(document.querySelector('${yInput}')?.value)===0`,
              (s) => /y:\s*0/.test(s),
            );
            await ctx.trustedClick('button[aria-label="Undo"]');
            sceneAfterProperty = await witness(
              ctx,
              "compositions/scene-one.html",
              `document.querySelectorAll('[data-timeline-property="y"] [data-keyframe-time]').length===0`,
              (s) => s === beforeStatic,
            );
            await ctx.trustedClick('[data-timeline-property="opacity"] [data-keyframe-time="1.8"]');
            await seek(ctx, 1.5, 8);
            const currentPosition = await position(ctx);
            ctx.assert(
              positionBefore?.every(Number.isFinite) && currentPosition?.every(Number.isFinite),
              "Runtime position values are available",
            );
            ctx.assert(
              currentPosition.every((value, i) => Math.abs(value - positionBefore[i]) < 0.01),
              `Position interpolation preserved: ${positionBefore} -> ${currentPosition}`,
            );
            await ready(ctx);
            await new Promise((resolve) => setTimeout(resolve, 1200));
            await ready(ctx);
            ctx.assert(/x:\s*100/.test(sceneAfterProperty), "Position endpoint remains unchanged");
            ctx.assert(
              /x:200,duration:2,ease:"power1.inOut"/.test(sceneAfterProperty),
              "Later position animation unchanged",
            );
          },
          screenshot: { name: "independent-property-keyframes", requireText: ["Opacity"] },
        }),
    },
    {
      name: "Extend layer display without changing fade",
      run: async (ctx) =>
        ctx.prove("Extending a layer keeps its original animation timing", {
          voiceover: vo[5],
          action: async () => {
            await ctx.trustedClick('button[aria-label="Selection tool"]');
            await drag(ctx, title, 1, "end");
          },
          assert: async () => {
            sceneAfterTrim = await witness(
              ctx,
              "compositions/scene-one.html",
              `Number(document.querySelector(${JSON.stringify(title)})?.dataset.clipEnd)===7`,
              (s) => /data-duration="6"/.test(s),
            );
            ctx.assert(
              scripts(sceneAfterTrim) === scripts(sceneAfterProperty),
              "Extending display leaves animations exact",
            );
          },
          screenshot: {
            name: "display-extent-preserves-fade",
            requireText: ["Scene editing", "Title"],
          },
        }),
    },
    {
      name: "Explicit stretch retimes animation",
      run: async (ctx) =>
        ctx.prove("Only the Stretch tool changes animation speed", {
          voiceover: vo[6],
          action: async () => {
            await ctx.trustedClick('button[aria-label="Stretch tool"]');
            await drag(ctx, title, 1, "end");
          },
          assert: async () => {
            sceneAfterStretch = await witness(
              ctx,
              "compositions/scene-one.html",
              `Number(document.querySelector(${JSON.stringify(title)})?.dataset.clipEnd)===8`,
              (s) => scripts(s) !== scripts(sceneAfterTrim),
            );
            ctx.assert(
              scripts(sceneAfterStretch) !== scripts(sceneAfterTrim),
              "Explicit stretch retimes animation script",
            );
            await ctx.waitFor(
              `[...document.querySelectorAll('[data-timeline-property="opacity"] [data-keyframe-time]')].some(e=>Number(e.dataset.keyframeTime)>1.9)`,
              { timeoutMs: 15000 },
            );
          },
          screenshot: { name: "explicit-stretch", requireText: ["Scene editing", "Title"] },
        }),
    },
    {
      name: "Return and undo one complete edit",
      run: async (ctx) =>
        ctx.prove("Returning shows the updated scene and undo restores the entire stretch", {
          voiceover: vo[7],
          action: async () => {
            await ctx.trustedClick('button[aria-label="Back to parent composition"]');
            await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(scene)}))`, {
              timeoutMs: 30000,
            });
            await ctx.trustedClick('button[aria-label="Undo"]');
          },
          assert: async () => {
            await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(scene)}))`, {
              timeoutMs: 15000,
            });
            const saved = await witness(
              ctx,
              "compositions/scene-one.html",
              `Boolean(document.querySelector(${JSON.stringify(scene)}))`,
              (s) => s === sceneAfterTrim,
            );
            ctx.assert(saved === sceneAfterTrim, "Single undo restores complete pre-stretch file");
          },
          screenshot: {
            name: "return-and-undo",
            requireText: ["Total timeline", "Scene One", "Closing"],
          },
        }),
    },
  ],
};

export { project, studioUrl, sceneSource, scripts, frame, ready, rect, mouse, seek, doubleClick, witness };
