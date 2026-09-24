import { execFileSync, spawnSync } from "node:child_process";
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(import.meta.dirname, "../..");
const registryRoot = join(repo, "vendor/hyperframes/registry/blocks");
const catalogPath = join(repo, "apps/server/bundled-templates/core-v1-video-motion-catalog.md");
const componentMapPath = join(repo, "apps/server/bundled-templates/core-v1-video-motion-component-map.md");
const cliPath = join(repo, "vendor/hyperframes/packages/cli/bin/hyperframes.mjs");
const gsapPath = join(repo, "vendor/hyperframes/node_modules/.bun/gsap@3.15.0/node_modules/gsap/dist/gsap.min.js");
const MAX_STILL_SECONDS = 4;
const cases = [
  { pattern: "progressive-build", component: "checklist-reveal", visibleText: "Checklist Reveal" },
  { pattern: "focus-transfer", component: "product-comparison-stage", visibleText: "Product Comparison Stage" },
  { pattern: "path-journey", component: "milestone-timeline", visibleText: "A path from intent to impact" },
  { pattern: "state-transformation", component: "media-before-after", visibleText: "Media Before / After" },
  { pattern: "data-accumulation", component: "bar-chart-race", visibleText: "Category leaders" },
  { pattern: "asset-exploration", component: "mobile-walkthrough", visibleText: "A complete flow in three taps" },
  { pattern: "montage", component: "device-carousel", visibleText: "Device Carousel" },
  { pattern: "camera-journey", component: "mobile-walkthrough", visibleText: "A complete flow in three taps" },
  { pattern: "dialogue", component: "speaker-intro", visibleText: "Speaker Intro" },
  { pattern: "kinetic-type", component: "kinetic-keyword", visibleText: "Kinetic Keyword" },
  { pattern: "audio-reactive", component: "oscilloscope-trace", visibleText: "Signal trace" },
];
let temporalState;
let installedComponentPath;
let transitionProofPath;

function componentPath(component) {
  return join(registryRoot, component, `${component}.html`);
}

function narratedPacingFixture(duration) {
  const beatCount = Math.ceil(duration / 3);
  const beats = Array.from({ length: beatCount }, (_, index) => {
    const start = index * 3;
    const end = Math.min(duration, start + 3);
    return {
      start,
      end,
      intent: `Narration beat ${index + 1}`,
      focus: `Card ${index + 1}`,
      action: index === 0 ? "Establish the first idea" : "Advance to the next idea",
      result: `Idea ${index + 1} is visible`,
      targets: [`#card-${index + 1}`],
      animation: `custom:narration-beat-${index + 1}`,
      motion: { start, end: Math.min(end, start + 0.8) },
    };
  });
  const cards = beats.map((_, index) => `<article id="card-${index + 1}"><span>${String(index + 1).padStart(2, "0")}</span><h1>${duration}s narration scene</h1><p data-ipw-narration-source="true">The visual focus advances with spoken idea ${index + 1}, then holds briefly for comprehension.</p></article>`).join("");
  const tweens = beats.map((beat, index) => {
    const previous = index > 0 ? `.to('#card-${index}',{autoAlpha:0,y:-24,duration:.45},${beat.start})` : "";
    return `${previous}.fromTo('#card-${index + 1}',{autoAlpha:0,y:34,scale:.97},{autoAlpha:1,y:0,scale:1,duration:.8,ease:'power2.out'},${beat.start})`;
  }).join("");
  return `<!doctype html><html><head><meta charset="UTF-8"><style>*{box-sizing:border-box}html,body{margin:0;width:960px;height:540px;overflow:hidden;background:#071924;color:#f8f1df;font-family:Arial,sans-serif}main{position:relative;width:960px;height:540px;background:radial-gradient(circle at 80% 12%,#17485b,#071924 58%)}article{position:absolute;inset:70px;display:flex;flex-direction:column;justify-content:flex-end;padding:54px;border:1px solid #69d2d0;border-radius:28px;background:rgba(8,31,43,.86)}span{color:#ed9d58;font:700 20px/1 monospace;letter-spacing:.16em}h1{margin:18px 0;font-size:62px;letter-spacing:-.05em}p{max-width:690px;margin:0;color:#b7cbd0;font-size:25px;line-height:1.45}</style></head><body><main data-composition-id="narration-${duration}" data-width="960" data-height="540" data-fps="12" data-duration="${duration}"><section id="scene-${duration}" class="scene clip" data-ipw-scene data-ipw-component-decision="custom:pacing render acceptance fixture" data-motion-pattern="progressive-build" data-ipw-timing-source="estimated-reading" data-ipw-beats='${JSON.stringify(beats)}' data-start="0" data-duration="${duration}" data-track-index="0">${cards}</section></main><script src="./gsap.min.js"></script><script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.set('article',{autoAlpha:0},0)${tweens};tl.to({}, {duration:${duration}});window.__timelines['narration-${duration}']=tl;tl.seek(0);</script></body></html>`;
}

export default {
  id: "video-temporal-story-library",
  title: "Temporal story patterns route to real seekable Video Studio components",
  kind: "internal",
  preserveTheme: true,
  steps: [{
    name: "Catalog mappings resolve to shipped registry components",
    run: async (ctx) => {
      const catalog = await readFile(catalogPath, "utf8");
      const componentMap = await readFile(componentMapPath, "utf8");
      const mappedComponents = [...componentMap.matchAll(/^\| `([^`]+)` \| (?:opening|body|closing|overlay \/ any) \|/gm)].map((match) => match[1]).sort();
      const videoComponents = [];
      for (const component of await readdir(registryRoot)) {
        try {
          const manifest = JSON.parse(await readFile(join(registryRoot, component, "registry-item.json"), "utf8"));
          if (manifest.visualComponent?.surfaces?.includes("video")) videoComponents.push(component);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      videoComponents.sort();
      ctx.assert(JSON.stringify(mappedComponents) === JSON.stringify(videoComponents), "The temporal map covers the exact current Video Studio registry set");
      for (const item of cases) {
        ctx.assert(catalog.includes(`\`${item.component}\``), `${item.pattern} does not route to ${item.component}`);
        await access(componentPath(item.component));
        const manifest = JSON.parse(await readFile(join(registryRoot, item.component, "registry-item.json"), "utf8"));
        ctx.assert(manifest.engine?.seekable === true, `${item.component} is not declared seekable`);
        ctx.assert(manifest.visualComponent?.surfaces?.includes("video"), `${item.component} is not available to Video Studio`);
      }
      await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    },
  }, {
    name: "Selected components install into and validate against the active project",
    run: async (ctx) => {
      const workspace = resolve(ctx.outDir, "workspace");
      const project = join(workspace, "video", "component-reuse");
      await mkdir(project, { recursive: true });
      await writeFile(join(project, "index.html"), `<!doctype html><html><head><meta charset="UTF-8"></head><body>
        <main data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="9">
          <section id="roadmap" class="scene clip" data-ipw-scene data-composition-id="milestone-timeline-roadmap" data-composition-src="compositions/milestone-timeline.html" data-ipw-registry-component="milestone-timeline" data-ipw-timing-owner="host" data-motion-pattern="path-journey" data-ipw-timing-source="estimated-reading" data-ipw-beats='[{"start":0,"end":3,"intent":"Frame the route","focus":"Opening milestone","action":"Reveal the first step","result":"The opening step holds","targets":["#roadmap"],"animation":"component:milestone-timeline","motion":{"start":0,"end":3}},{"start":3,"end":6,"intent":"Advance the plan","focus":"Middle milestone","action":"Connect the second step","result":"Two milestones remain visible","targets":["#roadmap"],"animation":"component:milestone-timeline","motion":{"start":3,"end":6}},{"start":6,"end":9,"intent":"Land the plan","focus":"Complete route","action":"Reveal the final step","result":"The complete route holds","targets":["#roadmap"],"animation":"component:milestone-timeline","motion":{"start":6,"end":9}}]' data-variable-values='{"title":"90 days to open","stepOne":"Inspect","stepTwo":"Build","stepThree":"Open"}' data-start="0" data-duration="9" data-track-index="0"></section>
        </main>
        <script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script>
        <script>window.__timelines=window.__timelines||{};window.__timelines.main=gsap.timeline({paused:true});</script>
      </body></html>`);
      const moduleUrl = pathToFileURL(join(repo, "apps/server/src/extensions/video-components.ts")).href;
      const output = execFileSync("bun", ["--eval", `
        import { installVideoComponents, checkVideoComponents } from ${JSON.stringify(moduleUrl)};
        const workspace = { id: "fraimz", path: ${JSON.stringify(workspace)} };
        const sourcePath = "video/component-reuse/index.html";
        const installed = await installVideoComponents(workspace, { sourcePath, componentIds: ["milestone-timeline"] });
        const checked = await checkVideoComponents(workspace, { sourcePath });
        console.log(JSON.stringify({ installed, checked }));
      `], { cwd: repo, encoding: "utf8", env: { ...process.env, IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT: registryRoot } });
      const result = JSON.parse(output);
      ctx.assert(result.installed.components[0]?.componentId === "milestone-timeline", "The selected component was installed from the bundled registry");
      ctx.assert(result.checked.valid === true && result.checked.reusedComponentCount === 1, "The active project records one valid real component reference");
      const lint = JSON.parse(execFileSync("node", [join(repo, "vendor/hyperframes/packages/cli/bin/hyperframes.mjs"), "lint", project, "--json"], { cwd: repo, encoding: "utf8" }));
      ctx.assert(lint.ok === true, "The installed subcomposition and host pass HyperFrames lint");
      installedComponentPath = join(project, "compositions", "milestone-timeline.html");
    },
  }, {
    name: "Installed component preserves its native visual and timeline",
    run: async (ctx) => {
      await ctx.prove("The project-installed component renders its native registry treatment", {
        action: async () => {
          await ctx.client.send("Page.navigate", { url: pathToFileURL(installedComponentPath).href });
          await ctx.waitFor("document.readyState === 'complete' && Boolean(window.__timelines?.['milestone-timeline'])", { timeoutMs: 30_000, label: "installed component timeline" });
          await ctx.eval("window.__timelines['milestone-timeline'].progress(0.65); true");
        },
        assert: async () => {
          const hasTitle = await ctx.eval("Boolean(document.querySelector('[data-ipw-variable=title]').textContent.trim())");
          const visibleSteps = await ctx.eval("Array.from(document.querySelectorAll('.step')).filter((element) => Number(getComputedStyle(element).opacity) > 0.05).length");
          ctx.assert(hasTitle && visibleSteps === 3, "Installed component has visible native content and developed timeline state");
        },
        screenshot: { name: "installed-milestone-timeline", requireText: ["A path from intent to impact"] },
      });
    },
  }, {
    name: "Incoming transitions preserve a visible boundary and deterministic seek states",
    run: async (ctx) => {
      transitionProofPath = join(ctx.outDir, "incoming-transition-proof.html");
      await writeFile(transitionProofPath, `<!doctype html><html><head><meta charset="UTF-8"><style>
        html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#09131f;color:white;font-family:system-ui}.stage{position:relative;width:100vw;height:100vh}.scene{position:absolute;inset:0;display:grid;place-items:center}.card{width:62%;padding:72px;border-radius:36px;background:#15283a;border:1px solid #4e718f}.two{background:#e9e0ce;color:#18222d}.label{font-size:28px;letter-spacing:.12em;text-transform:uppercase;opacity:.7}h1{font-size:76px;margin:20px 0 0}
      </style></head><body><main class="stage" data-composition-id="transition-proof" data-duration="6">
        <section id="context" class="scene clip" data-ipw-scene data-ipw-component-decision="custom:transition acceptance fixture" data-motion-pattern="progressive-build" data-ipw-timing-source="visual-cue" data-ipw-beats='[{"start":0,"end":3,"intent":"Establish context","focus":"Context card","action":"Keep the premise readable","result":"Premise lands","targets":["#context .card"],"animation":"hold:reading","motion":{"start":0,"end":3}}]' data-start="0" data-duration="3" data-track-index="0"><div class="card"><div class="label">Context</div><h1>The route is established</h1></div></section>
        <section id="decision" class="scene clip two" data-ipw-scene data-ipw-component-decision="custom:transition acceptance fixture" data-motion-pattern="state-transformation" data-ipw-timing-source="visual-cue" data-ipw-transition-in="preset:transition.split-wipe" data-ipw-transition-duration="0.8" data-ipw-transition-intent="reveal" data-ipw-animation-reference="transition.split-wipe" data-ipw-beats='[{"start":0,"end":0.8,"intent":"Reveal the decision","focus":"Decision card","action":"Wipe in the incoming scene","result":"Decision becomes clear","targets":["#decision"],"animation":"preset:transition.split-wipe","motion":{"start":0,"end":0.8}},{"start":0.8,"end":3,"intent":"Land the decision","focus":"Decision card","action":"Keep the result readable","result":"Decision holds","targets":["#decision .card"],"animation":"hold:reading","motion":{"start":0.8,"end":3}}]' data-start="3" data-duration="3" data-track-index="0"><div class="card"><div class="label">Decision</div><h1>The next step is visible</h1></div></section>
      </main><script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script><script>
        window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.set('#context',{autoAlpha:1},0).set('#decision',{autoAlpha:0},0).set('#context',{autoAlpha:0},3).set('#decision',{autoAlpha:1},3).fromTo('#decision .card',{opacity:0,xPercent:28,clipPath:'inset(0 0 0 100%)'},{opacity:1,xPercent:0,clipPath:'inset(0 0 0 0%)',duration:.8,ease:'power3.inOut'},3);window.__timelines['transition-proof']=tl;
      </script></body></html>`);
      await ctx.prove("The incoming transition has visible before, during, and after states", {
        action: async () => {
          await ctx.client.send("Page.navigate", { url: pathToFileURL(transitionProofPath).href });
          await ctx.waitFor("document.readyState === 'complete' && Boolean(window.__timelines?.['transition-proof'])", { timeoutMs: 30_000, label: "transition proof timeline" });
          temporalState = await ctx.eval(`(() => { const tl=window.__timelines['transition-proof']; const state=(t)=>{tl.time(t);const node=document.querySelector('#decision .card');const style=getComputedStyle(node);return {opacity:Number(style.opacity),transform:style.transform,text:node.textContent.trim()}};return {before:state(2.95),during:state(3.32),after:state(3.85)}})()`);
          await ctx.eval("window.__timelines['transition-proof'].time(3.32); true");
        },
        assert: async () => {
          ctx.assert(temporalState.before.text.length > 0 && temporalState.during.text.length > 0 && temporalState.after.text.length > 0, "Transition states retain meaningful content");
          ctx.assert(temporalState.during.opacity > 0 && temporalState.during.opacity < 1 && temporalState.after.opacity > 0.99, `Incoming transition develops and lands deterministically: ${JSON.stringify(temporalState)}`);
        },
        screenshot: { name: "incoming-transition", requireText: ["The next step is visible"] },
      });
    },
  }, {
    name: "Representative components show deterministic temporal development",
    run: async (ctx) => {
      for (const item of cases) {
        await ctx.prove(`${item.pattern} uses a real component with observable seek states`, {
          action: async () => {
            await ctx.client.send("Page.navigate", { url: pathToFileURL(componentPath(item.component)).href });
            await ctx.waitFor(`document.readyState === "complete" && Boolean(window.__timelines?.[${JSON.stringify(item.component)}])`, { timeoutMs: 30_000, label: `${item.component} timeline` });
            const result = await ctx.eval(`(() => {
              const root = document.querySelector('[data-composition-id=${JSON.stringify(item.component)}]');
              const timeline = window.__timelines[${JSON.stringify(item.component)}];
              const signature = () => [...root.querySelectorAll('*')].map((element) => {
                const style = getComputedStyle(element);
                return [style.opacity, style.transform, style.clipPath, style.strokeDashoffset].join('|');
              }).join('||');
              const visible = () => [...root.querySelectorAll('*')].filter((element) => {
                const style = getComputedStyle(element);
                return style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
              }).length;
              timeline.progress(0.08);
              const establish = { signature: signature(), visible: visible() };
              timeline.progress(0.52);
              const develop = { signature: signature(), visible: visible() };
              timeline.progress(0.94);
              const land = { signature: signature(), visible: visible() };
              timeline.progress(0.52);
              return { establish, develop, land, duration: timeline.duration() };
            })()`);
            temporalState = result;
          },
          assert: async () => {
            const state = temporalState;
            ctx.assert(state.duration > 0, `${item.component} has no timeline duration`);
            ctx.assert(state.establish.signature !== state.develop.signature, `${item.component} does not change between Establish and Develop`);
            ctx.assert(state.develop.visible > 0 && state.land.visible > 0, `${item.component} has an empty Develop or Land state`);
          },
          screenshot: { name: `${item.pattern}-${item.component}`, requireText: [item.visibleText] },
        });
      }
    },
  }, {
    name: "10, 20, and 30 second narration scenes render without long frozen intervals",
    run: async (ctx) => {
      const workspace = resolve(ctx.outDir, "pacing-renders");
      const moduleUrl = pathToFileURL(join(repo, "apps/server/src/extensions/video-components.ts")).href;
      for (const duration of [10, 20, 30]) {
        const project = join(workspace, "video", `${duration}s`);
        const output = join(project, "renders", `narration-${duration}s.mp4`);
        await mkdir(join(project, "renders"), { recursive: true });
        await writeFile(join(project, "index.html"), narratedPacingFixture(duration));
        await copyFile(gsapPath, join(project, "gsap.min.js"));
        const checked = JSON.parse(execFileSync("bun", ["--eval", `
          import { checkVideoComponents } from ${JSON.stringify(moduleUrl)};
          console.log(JSON.stringify(await checkVideoComponents({ id: "fraimz", path: ${JSON.stringify(workspace)} }, { sourcePath: ${JSON.stringify(`video/${duration}s/index.html`)} })));
        `], { cwd: repo, encoding: "utf8" }));
        ctx.assert(checked.valid === true, `${duration}s pacing fixture failed structural validation: ${JSON.stringify(checked.issues)}`);
        execFileSync("node", [cliPath, "render", project, "--output", output, "--fps", "12", "--quality", "draft", "--workers", "1", "--quiet"], { cwd: repo, encoding: "utf8", stdio: "pipe", timeout: 600_000 });
        ctx.assert((await stat(output)).size > 10_000, `${duration}s render is missing or empty`);
        const probed = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", output], { encoding: "utf8" }).trim());
        ctx.assert(Math.abs(probed - duration) < 0.15, `${duration}s render duration is ${probed}s`);
        const freeze = spawnSync("ffmpeg", ["-hide_banner", "-i", output, "-vf", `freezedetect=n=0.001:d=${MAX_STILL_SECONDS + 0.05}`, "-f", "null", "-"], { encoding: "utf8", timeout: 300_000 });
        ctx.assert(freeze.status === 0, `ffmpeg freeze analysis failed: ${(freeze.stderr ?? freeze.error?.message ?? "unknown error").slice(-800)}`);
        const frozenDurations = [...(freeze.stderr ?? "").matchAll(/freeze_duration:\s*([\d.]+)/gu)].map(match => Number(match[1]));
        const starts = [...(freeze.stderr ?? "").matchAll(/freeze_start:\s*([\d.]+)/gu)].map(match => Number(match[1]));
        const ends = [...(freeze.stderr ?? "").matchAll(/freeze_end:\s*([\d.]+)/gu)].map(match => Number(match[1]));
        if (starts.length > ends.length) frozenDurations.push(probed - (starts.at(-1) ?? probed));
        ctx.assert(frozenDurations.every(value => value <= MAX_STILL_SECONDS + 0.05), `${duration}s render contains a frozen interval longer than ${MAX_STILL_SECONDS}s: ${frozenDurations.join(", ")}`);
      }
    },
  }],
};
