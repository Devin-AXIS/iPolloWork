import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(import.meta.dirname, "../..");
const cliPath = join(repo, "vendor/hyperframes/packages/cli/bin/hyperframes.mjs");
const gsapPath = join(repo, "vendor/hyperframes/node_modules/.bun/gsap@3.15.0/node_modules/gsap/dist/gsap.min.js");
const MAX_STILL_SECONDS = 4;
let temporalState;
let transitionProofPath;

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
  title: "Temporal transitions and narrated pacing stay seekable",
  kind: "internal",
  preserveTheme: true,
  steps: [{
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
  },
{
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
