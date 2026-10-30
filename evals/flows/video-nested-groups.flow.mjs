import { readFile, writeFile } from "node:fs/promises";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import base, { project, studioUrl, frame, ready, rect, mouse, seek, doubleClick } from "./video-editing-phase-one.flow.mjs";

const vo = await loadVoiceoverParagraphs("video-nested-groups");
const source = `<!doctype html><html><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script><style>
html,body{margin:0;width:1280px;height:720px;background:#ece7dc;font-family:Arial;color:#252525}
.scene{position:absolute;inset:0;padding:120px;box-sizing:border-box;background:#ece7dc}
h1{font-size:64px}p{font-size:28px}.global{position:absolute;top:36px;left:48px;z-index:20;font-size:20px}
</style></head><body><main data-composition-id="main" data-duration="24" data-width="1280" data-height="720" data-fps="30">
<div id="global-logo" class="clip global" data-hf-id="global-logo" data-label="Global Logo" data-start="0" data-duration="24" data-track-index="0">Shared logo</div>
<section id="scene-alpha" class="scene clip" data-hf-id="scene-alpha" data-label="Scene Alpha" data-start="8" data-duration="8" data-track-index="2"><div id="layout-wrap" data-hf-group="Layout"><div id="title-group" data-hf-id="title-group" data-hf-group="Title Group"><div id="inner-wrap" data-hf-group="Inner layout"><h1 id="title" data-hf-id="title" data-label="Title">Editable title</h1><p class="shared-subtitle" data-hf-id="subtitle" data-label="Subtitle">Scene-local layers, preserved global motion</p></div></div></div></section>
<section id="scene-beta" class="scene clip" data-hf-id="scene-beta" data-label="Scene Beta" data-start="0" data-duration="8" data-track-index="1"><h1 id="beta-title">Second scene</h1></section>
<section id="scene-gamma" class="scene clip" data-hf-id="scene-gamma" data-label="Scene Gamma" data-start="16" data-duration="8" data-track-index="3"><h1 id="gamma-title">Third scene</h1></section>
<audio id="voice-alpha" class="clip" data-hf-id="voice-alpha" data-label="Voice Alpha" data-start="8" data-duration="7" data-track-index="10" src="assets/voice.wav"></audio>
<audio id="voice-beta" class="clip" data-hf-id="voice-beta" data-label="Voice Beta" data-start="0" data-duration="7" data-track-index="10" src="assets/voice.wav"></audio>
<audio id="voice-gamma" class="clip" data-hf-id="voice-gamma" data-label="Voice Gamma" data-start="16" data-duration="7" data-track-index="10" src="assets/voice.wav"></audio>
</main><script>const tl=gsap.timeline({paused:true});
tl.to("#scene-alpha",{keyframes:{"0%":{scale:0.96,opacity:0},"100%":{scale:1,opacity:1}},duration:0.8,ease:"none"},8);
tl.fromTo("#title-group",{y:-24},{y:0,duration:0.7,ease:"none"},8.6);
tl.to("#title",{keyframes:{"0%":{x:0,opacity:0},"50%":{x:38,opacity:0.65},"100%":{x:100,opacity:1}},duration:2,ease:"none"},10);
tl.fromTo(".shared-subtitle",{y:20,opacity:0},{y:0,opacity:1,duration:1,ease:"none"},8.5);
tl.to("#scene-beta",{keyframes:{"0%":{opacity:0},"100%":{opacity:1}},duration:0.8,ease:"none"},0);
tl.to({}, {duration:24},0);window.__timelines=window.__timelines||{};window.__timelines.main=tl;</script></body></html>`;
const alpha = '[data-el-id="index.html#scene-alpha"]';
const group = '[data-layer-dom-id="title-group"] .hf-timeline-layer-header__select';
const title = '[data-layer-dom-id="title"] .hf-timeline-layer-header__select';
const back = 'button[aria-label="Back to parent composition"]';
const opacity = '[data-owner-id="title"][data-timeline-property="opacity"]';
let original;
let originalMotion;
let editedSource;

async function saved() { return readFile(project + "index.html", "utf8"); }
async function stable(ctx) { await ready(ctx); await new Promise(r => setTimeout(r, 400)); await ctx.waitFor(`${frame}?.getRootNode()?.host?.painted===true`,{timeoutMs:30000}); }
async function noWrite(ctx, action) {
  const before = await saved();
  await action();
  await stable(ctx);
  ctx.assert(await saved() === before, "Navigating or expanding never rewrites the original composition");
}
async function motion(ctx) {
  return ctx.eval(`(()=>{const f=${frame},e=f?.contentDocument.querySelector('#title');return e?['x','opacity','scale'].map(p=>Number(f.contentWindow.gsap.getProperty(e,p))):null})()`);
}
async function parent(ctx) { await ctx.trustedClick(back); await stable(ctx); }
async function localSeek(ctx, time, duration, offset) {
  const r = await rect(ctx, '[role="slider"][aria-label="Seek"]');
  const x = r.x + r.width * time / duration, y = r.y + r.height / 2;
  await mouse(ctx, "mousePressed", x, y);
  await mouse(ctx, "mouseReleased", x, y);
  await ctx.waitFor(`Math.abs((${frame}?.contentWindow?.__player?.getTime()??-100)-${offset + time})<0.06`);
}
async function subtitleCanvasSelected(ctx) {
  await ctx.waitFor(`(()=>{const f=${frame},e=f?.contentDocument.querySelector('[data-hf-id="subtitle"]'),b=document.querySelector('[data-dom-edit-selection-box="true"]');if(!f||!e||!b)return false;const r=e.getBoundingClientRect(),v=f.getBoundingClientRect(),s=v.width/f.clientWidth,q=b.getBoundingClientRect();return Math.abs(q.x+q.width/2-(v.x+(r.x+r.width/2)*s))<8&&Math.abs(q.y+q.height/2-(v.y+(r.y+r.height/2)*s))<8})()`);
}

function silence() {
  const rate = 8000, size = rate * 2 * 8, wav = Buffer.alloc(44 + size);
  wav.write("RIFF"); wav.writeUInt32LE(size + 36, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(size, 40);
  return wav;
}

export default {
  id: "video-nested-groups",
  title: "场景嵌套组、名称展开属性与单音频轨道",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "127.0.0.1:5191" },
  precondition: async ctx => {
    await ctx.client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await ctx.client.send("Page.bringToFront");
    await base.precondition(ctx);
    await writeFile(project + "assets/voice.wav", silence());
    await writeFile(project + "index.html", source);
    await ctx.client.send("Page.navigate", { url: "about:blank" });
    await ctx.client.send("Page.navigate", { url: studioUrl });
    await ctx.waitFor(`!!document.querySelector(${JSON.stringify(alpha)})`);
    await stable(ctx);
    await seek(ctx, 10.5, 24);
    if (await ctx.eval(`document.querySelector('button[aria-label="Show thumbnails"]')?.getAttribute('aria-pressed')==='false'`)) await ctx.trustedClick('button[aria-label="Show thumbnails"]');
    original = await saved();
    originalMotion = await motion(ctx);
    return null;
  },
  steps: [
    {
      name: "Master scenes and audio",
      run: ctx => ctx.prove("Master keeps shared layers and separate scene tracks with one audio lane", {
        voiceover: vo[0],
        action: async () => stable(ctx),
        assert: async () => {
          const layout = await ctx.eval(`(()=>{const clips=[...document.querySelectorAll('[data-el-id]')].filter(e=>e.classList.contains('timeline-clip'));return {ids:clips.map(e=>e.dataset.elId),lanes:document.querySelectorAll('.hf-timeline-layer-header').length}})()`);
          ctx.assert(layout.lanes === 5, "Shared logo, three scenes and one audio each have their own display lanes");
          ctx.assert(layout.ids.length === 7 && layout.ids.every(id => /#(global-logo|scene-|voice-)/.test(id)), "Shared layers stay in master while internal layers stay nested");
          ctx.assert(await ctx.eval(`!!document.querySelector('[data-layer-dom-id="global-logo"]') && !document.querySelector('.timeline-clip__label')`), "Shared logo is editable in master and clip captions do not repeat layer names");
          ctx.assert(await ctx.eval(`!!document.querySelector('.hf-timeline-pane nav[aria-label="Composition navigation"]') && !document.querySelector('.hf-preview-pane nav[aria-label="Composition navigation"]')`), "Navigation belongs to the timeline module");
          await ctx.waitFor(`(()=>{const img=document.querySelector(${JSON.stringify(alpha)}+' .hf-timeline-clip-content img');return !!img&&img.complete&&img.naturalWidth>0})()`);
          await stable(ctx);
          ctx.assert(await ctx.eval(`!document.querySelector('[data-el-id="index.html#global-logo"] [data-animation-id]')`), "Static shared clips do not display an animation strip");
          await ctx.waitFor(`!!document.querySelector(${JSON.stringify(alpha)}+' [data-testid="timeline-keyframe-overlay"]')`);
          ctx.assert(await ctx.eval(`!document.querySelector('[data-testid="timeline-animation-overlay"]')&&!!document.querySelector(${JSON.stringify(alpha)}+' path[fill="#19BAC2"]')`), "Overview scenes show cyan keyframes on their thumbnails without animation strips");
          ctx.assert(await saved() === original, "Master presentation preserves every source track and keyframe");
        },
        screenshot: { name: "master-scene-audio", requireText: ["Scene Alpha", "Scene Beta", "Scene Gamma"], rejectText: ["Something went wrong"] },
      }),
    },
    {
      name: "Scene layers are flat",
      run: ctx => ctx.prove("Entering a scene exposes descendants and animated groups without further navigation", {
        voiceover: vo[1],
        action: async () => {
          await noWrite(ctx, async () => doubleClick(ctx, alpha));
          await ctx.waitFor(`!!document.querySelector(${JSON.stringify(title)}) && !!document.querySelector(${JSON.stringify(group)})`);
          await noWrite(ctx, async () => ctx.trustedClick(group));
          await ctx.waitFor(`!!document.querySelector('[data-owner-id="title-group"][data-timeline-property="y"]')`);
          await noWrite(ctx, async () => doubleClick(ctx, group));
          await noWrite(ctx, async () => {
            await ctx.eval(`document.querySelector(${JSON.stringify(group)}).focus()`);
            for (const type of ["keyDown", "keyUp"]) await ctx.client.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 2 });
          });
          await noWrite(ctx, async () => ctx.trustedClick('[data-layer-hf-id="subtitle"] .hf-timeline-layer-header__select'));
          await subtitleCanvasSelected(ctx);
          await ctx.waitFor(`document.querySelectorAll('[data-owner-key="index.html#subtitle"][data-timeline-property]').length===2`);
          ctx.assert(await ctx.eval(`JSON.stringify([...document.querySelectorAll('[data-owner-key="index.html#subtitle"][data-timeline-property]')].map(e=>e.dataset.timelineProperty))==='["y","opacity"]'`), "One name click reveals existing shared animation channels on hf-only scene children");
          ctx.assert(await ctx.eval(`(()=>{const rows=[...document.querySelectorAll('[data-owner-key="index.html#subtitle"][data-timeline-property]')];return rows.every(e=>e.querySelectorAll('[data-keyframe-percentage]').length===2 && !e.querySelector('input:not(:disabled)'))})()`), "Shared source keyframes remain visible and read-only");
          await noWrite(ctx, async () => ctx.trustedClick(group));
          await noWrite(ctx, async () => ctx.trustedClick('[data-el-id="index.html#subtitle"]'));
          await subtitleCanvasSelected(ctx);

        },
        assert: async () => {
          ctx.assert(await ctx.eval(`!!document.querySelector(${JSON.stringify(back)})`), "Back to parent is visible");
          ctx.assert(await ctx.eval(`!document.querySelector('[data-layer-dom-id="scene-alpha"]') && !document.querySelector('[data-layer-scene-role="scene"]')`), "Inside a scene, the scene owner stays in overview instead of duplicating an overall layer");
          ctx.assert(await ctx.eval(`!document.querySelector('[data-testid="timeline-visual-row"]')`), "Animation summaries never allocate a second miniature track");
          ctx.assert(await ctx.eval(`(()=>{const overlays=[...document.querySelectorAll('[data-testid="timeline-keyframe-overlay"]')];return overlays.length>0&&!document.querySelector('[data-testid="timeline-animation-overlay"]')&&overlays.every(e=>e.closest('[data-clip]'))})()`), "Keyframes appear on thumbnail clips with no animation duration strips");
          ctx.assert(await ctx.eval(`!document.querySelector('[data-layer-dom-id="layout-wrap"]') && !document.querySelector('[data-layer-dom-id="inner-wrap"]') && document.querySelector('[data-layer-dom-id="title"]')?.dataset.layerParentLabel==='Title Group' && document.querySelectorAll('.hf-timeline-pane nav button').length===2`), "Layout wrappers are hidden, group association stays visible, and group gestures do not add another navigation level");
          const now = await motion(ctx);
          ctx.assert(now?.every((value, index) => Math.abs(value - originalMotion[index]) < 0.01), "Inline navigation preserves the original global animation frame");
          ctx.assert(await ctx.eval(`!document.querySelector('[data-layer-dom-id="beta-title"]') && !document.querySelector('[data-layer-dom-id="gamma-title"]')`), "Only the current scene layers are shown");
          ctx.assert(await ctx.eval(`!document.querySelector('[data-layer-dom-id="global-logo"]') && Number(document.querySelector('[role="slider"][aria-label="Seek"]')?.getAttribute('aria-valuemax'))===8`), "Scene-local editing excludes shared rows and displays eight seconds");
        },
        screenshot: { name: "flat-scene-layers", requireText: ["Title Group", "Title", "Subtitle"], rejectText: ["Something went wrong"] },
      }),
    },
    {
      name: "Name expands property keys",
      run: ctx => ctx.prove("Clicking a layer name expands only its authored channels and edits independently", {
        voiceover: vo[2],
        action: async () => {
          await noWrite(ctx, async () => ctx.trustedClick(title));
          await ctx.waitFor(`!!document.querySelector(${JSON.stringify(opacity)})`);
          await noWrite(ctx, async () => ctx.trustedClick(title));
          await ctx.waitFor(`!document.querySelector(${JSON.stringify(opacity)})`);
          await noWrite(ctx, async () => ctx.trustedClick(title));
          await ctx.waitFor(`!!document.querySelector(${JSON.stringify(opacity)})`);
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`JSON.stringify([...document.querySelectorAll('[data-owner-id="title"][data-timeline-property]')].map(e=>e.dataset.timelineProperty))==='["x","opacity"]'`), "No empty property or transform group rows are added");
          ctx.assert(await ctx.eval(`document.querySelector('[data-layer-dom-id="title"]')?.classList.contains('is-selected')`), "The nested layer remains selected after its name is clicked");
          ctx.assert(await ctx.eval(`!!document.querySelector(${JSON.stringify(opacity)}+' [data-timeline-property-connector][aria-hidden="true"]')`), "Property rows show their parent connection");
          await ctx.trustedClick(`${opacity} [data-keyframe-percentage="50"]`);
          const input = `${opacity} input[aria-label="opacity keyframe value at 50%"]`;
          await ctx.trustedClick(input);
          await ctx.fill(input, "70");
          for (const type of ["keyDown", "keyUp"]) await ctx.client.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
          await ctx.waitFor(`document.querySelector(${JSON.stringify(input)})?.value==='70'`);
          const savedDeadline = Date.now() + 15000;
          while (await saved() === original && Date.now() < savedDeadline) await new Promise(r => setTimeout(r, 100));
          ctx.assert(await saved() !== original, "Only explicit keyframe editing writes the composition");
          await localSeek(ctx, 3, 8, 8);
          await ctx.waitFor(`(()=>{const f=${frame},e=f?.contentDocument.getElementById('title');return !!e&&Math.abs(Number(f.contentWindow.gsap.getProperty(e,'opacity'))-0.7)<0.01&&Math.abs(Number(f.contentWindow.gsap.getProperty(e,'x'))-38)<0.01})()`);
          const now = await motion(ctx);
          ctx.assert(Math.abs(now[0] - 38) < 0.01 && Math.abs(now[1] - 0.7) < 0.01, "Manual position remains exact while opacity updates");
          editedSource = await saved();
          await stable(ctx);
          await ctx.waitFor(`document.querySelector(${JSON.stringify(input)})?.value==='70'&&document.querySelectorAll('[data-owner-id="title"][data-timeline-property]').length===2`);
          await stable(ctx);
          ctx.assert(await ctx.eval(`document.querySelector(${JSON.stringify(input)})?.value==='70'&&document.querySelectorAll('[data-owner-id="title"][data-timeline-property]').length===2`), "Saving and refreshing preserves expanded property rows and the selected keyframe");
        },
        screenshot: { name: "name-property-edit", requireText: ["Title", "Opacity"], rejectText: ["Something went wrong"] },
      }),
    },
    {
      name: "Scene own properties and drill-down",
      run: ctx => ctx.prove("A scene exposes its own animation while double-click still enters its layers", {
        voiceover: vo[3],
        action: async () => {
          await noWrite(ctx, async () => { await parent(ctx); });
          await noWrite(ctx, async () => ctx.trustedClick('[data-layer-dom-id="scene-alpha"] .hf-timeline-layer-header__select'));
          await ctx.waitFor(`!!document.querySelector('[data-owner-id="scene-alpha"][data-timeline-property="opacity"]')`);
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`JSON.stringify([...document.querySelectorAll('[data-owner-id="scene-alpha"][data-timeline-property]')].map(e=>e.dataset.timelineProperty))==='["scale","opacity"]'`), "Scene attributes are distinct from its child layers");
          await noWrite(ctx, async () => ctx.trustedClick('[data-layer-dom-id="scene-beta"] .hf-timeline-layer-header__select'));
          await ctx.waitFor(`!!document.querySelector('[data-owner-id="scene-beta"][data-timeline-property="opacity"]')`);
          ctx.assert(await ctx.eval(`!!document.querySelector('[data-owner-id="scene-alpha"][data-timeline-property]')`), "Each scene keeps its own independently expanded attributes");
          await noWrite(ctx, async () => doubleClick(ctx, '[data-el-id="index.html#scene-beta"]'));
          await ctx.waitFor(`!!document.querySelector('[data-layer-dom-id="beta-title"]')`);
          if (await ctx.eval(`!!document.querySelector('button[aria-label="Disable loop playback"]')`)) await ctx.trustedClick('button[aria-label="Disable loop playback"]');
          await localSeek(ctx, 7.8, 8, 0);
          await ctx.trustedClick('button[aria-label="Play"]');
          await new Promise(r => setTimeout(r, 750));
          const runtime = await ctx.eval(`(()=>{const f=${frame},d=f.contentDocument;return {time:f.contentWindow.__player.getTime(),others:['scene-alpha','scene-gamma'].map(id=>{const e=d.getElementById(id),s=f.contentWindow.getComputedStyle(e);return s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0})}})()`);
          ctx.assert(runtime.time >= 7.8 && runtime.time < 8 && runtime.others.every(Boolean), "Playback stops on the current scene's last frame and other scenes remain hidden");
          if (await ctx.eval(`!!document.querySelector('button[aria-label="Pause"]')`)) await ctx.trustedClick('button[aria-label="Pause"]');
          await localSeek(ctx, 2, 8, 0);
          ctx.assert(await saved() === editedSource, "Scene-local seeking, playback and isolation never rewrite the authored animation");
        },
        screenshot: { name: "scene-properties-navigation", requireText: ["Scene Beta"], rejectText: ["Something went wrong"] },
      }),
    },
    {
      name: "Return and preserve manual motion",
      run: ctx => ctx.prove("Parent return and undo preserve authored motion, with no caret or plus controls", {
        voiceover: vo[4],
        action: async () => {
          await noWrite(ctx, async () => parent(ctx));
          await ctx.trustedClick('button[aria-label="Undo"]');
          await ctx.waitFor(`!!document.querySelector(${JSON.stringify(alpha)})`);
        },
        assert: async () => {
          const end = Date.now() + 15000;
          while (await saved() !== original && Date.now() < end) await new Promise(r => setTimeout(r, 100));
          ctx.assert(await saved() === original, "Undo restores exact original bytes including pre-existing manual keyframe values");
          ctx.assert(await ctx.eval(`!document.querySelector('.hf-timeline-layer-header__caret') && !document.querySelector('button[aria-label="Add property"]')`), "No left disclosure arrow or plus button remains");
          await stable(ctx);
        },
        screenshot: { name: "returned-master-preserved", requireText: ["Scene Alpha", "Scene Beta", "Scene Gamma"], rejectText: ["Something went wrong"] },
      }),
    },
  ],
};
