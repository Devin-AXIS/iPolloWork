import { readFile, writeFile } from "node:fs/promises";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import base, {
  project,
  studioUrl,
  sceneSource,
  frame,
  ready,
  rect,
  mouse,
  seek,
  doubleClick,
  witness,
} from "./video-editing-phase-one.flow.mjs";
const vo = await loadVoiceoverParagraphs("video-layer-animation");
const singleFile = process.env.IPW_SINGLE_FILE_PROOF === "1";
const file = singleFile ? "index.html" : "compositions/scene-one.html";
const subtitle = `[data-el-id="${file}#subtitle"]`;
const card = '[data-template-id="general-fade-in"]';
let original, applied, manual, fromTimeline, otherBefore, afterProperty;
async function enter(ctx) {
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
}
async function otherValues(ctx) {
  return ctx.eval(
    `(()=>{const f=${frame};const e=f?.contentDocument.querySelector('#title');return e?['x','scale','rotation','opacity'].map(p=>Number(f.contentWindow.gsap.getProperty(e,p))):null})()`,
  );
}
async function stable(ctx) {
  await ready(ctx);
  const theme = process.env.IPW_PHASE_ONE_STUDIO_URL?.includes("ipolloworkTheme=dark") ? "dark" : "light";
  await ctx.eval(`window.postMessage({type:'ipollowork:studio-theme',theme:${JSON.stringify(theme)}},location.origin);true`);
  await ctx.waitFor(`document.documentElement.dataset.ipolloworkTheme===${JSON.stringify(theme)} && ${frame}?.getRootNode()?.host?.painted===true`, {timeoutMs:30000});
}
async function reopen(ctx) {
  const url = await ctx.eval('location.href');
  await ctx.client.send('Page.navigate', {url:'about:blank'});
  await ctx.waitFor(`location.href==='about:blank'`);
  await ctx.client.send('Page.navigate', {url});
  await stable(ctx);
}
async function exportAndReturn(ctx) {
  const snapshot = `JSON.stringify({tab:new URLSearchParams(location.hash.split('?')[1]).get('tab'),time:new URLSearchParams(location.hash.split('?')[1]).get('t'),layers:[...document.querySelectorAll('.hf-timeline-layer-header.is-selected')].map(e=>e.dataset.layerDomId),keys:[...document.querySelectorAll('[data-timeline-property] [data-keyframe-time][aria-pressed="true"]')].map(e=>[e.closest('[data-timeline-property]').dataset.timelineProperty,e.dataset.keyframeTime]),value:document.querySelector('[data-layer-effect-property][data-selected="true"] input')?.value})`;
  const before = await ctx.eval(snapshot);
  const source = await readFile(project + file, "utf8");
  await ctx.trustedClick('button[aria-label="Export"]');
  await ctx.waitFor(`!!document.querySelector('[data-testid="export-panel-back"]')`);
  ctx.assert(await ctx.eval(`(()=>{const b=document.querySelector('[data-testid="export-panel-back"]').getBoundingClientRect(),p=document.querySelector('.hf-studio-inspector').getBoundingClientRect();return b.x<p.x+72&&b.y<p.y+49})()`), "Export return button is at the panel's top left");
  await ctx.trustedClick('button[aria-label="Export"]');
  await ctx.trustedClick('[data-testid="export-panel-back"]');
  await ctx.waitFor(`${snapshot}===${JSON.stringify(before)}`);
  ctx.assert((await readFile(project + file, "utf8")) === source, "Export navigation preserves source and manual keys exactly");
  ctx.assert(!(await ctx.eval(`!!document.querySelector('[data-testid="export-panel-back"]')`)), "Return restores the previous editing panel");
}
export default {
  id: "video-layer-animation",
  title: "Layers统一动画编辑并保护手动关键帧",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "127.0.0.1:5191" },
  precondition: async (ctx) => {
    await ctx.client.send("Emulation.setFocusEmulationEnabled", {enabled:true});
    await base.precondition(ctx);
    original = await readFile(project + file, "utf8");
    if (singleFile) {
      await writeFile(
        project + file,
        sceneSource.replace("../assets/gsap.min.js", "assets/gsap.min.js"),
      );
      await ctx.client.send("Page.navigate", { url: "about:blank" });
      await ctx.client.send("Page.navigate", { url: studioUrl });
      original = await readFile(project + file, "utf8");
    } else {
      await doubleClick(ctx, '[data-el-id="index.html#scene-one"]');
    }
    await ctx.waitFor(`!!document.querySelector(${JSON.stringify(subtitle)})`);
    await ready(ctx);
    await seek(ctx, 1.5, 8);
    otherBefore = await otherValues(ctx);
    await ctx.trustedClick(subtitle);
    if (await ctx.eval(`!!document.querySelector('button[aria-label="Properties"]')`))
      await ctx.trustedClick('button[aria-label="Properties"]');
    await ctx.trustedClick('button[aria-label="Animation"]');
    return null;
  },
  steps: [
    {
      name: "Apply from library",
      run: (ctx) =>
        ctx.prove("Animation library applies one effect to the selected layer", {
          voiceover: vo[0],
          action: async () => {
            await ctx.eval(`document.querySelector('${card}')?.scrollIntoView({block:'center'})`);
            await ctx.trustedClick(`${card} [data-animation-action="apply"]`);
          },
          assert: async () => {
            applied = await witness(
              ctx,
              file,
              `document.querySelector('${card}')?.dataset.applied==='true'`,
              (s) => s !== original,
            );
            ctx.assert(applied.includes("general-fade-in"), "Real template identity saved");
            await stable(ctx);
          },
          screenshot: {
            name: "library-in-use",
            requireText: ["In use", "Fade In"],
            rejectText: ["Something went wrong"],
          },
        }),
    },
    {
      name: "Edit in Layers without popup",
      run: (ctx) =>
        ctx.prove("In use Edit opens one inline effect in Layers without changing animation", {
          voiceover: vo[1],
          action: async () => {
            await exportAndReturn(ctx);
            await ctx.trustedClick(`${card} [data-animation-action="edit"]`);
          },
          assert: async () => {
            await ctx.waitFor(
              `document.querySelector('button[aria-label="Layers"]')?.getAttribute('aria-pressed')==='true' || !!document.querySelector('[data-testid="semantic-motion-panel"]')`,
            );
            ctx.assert(
              !(await ctx.eval(
                `!!document.querySelector('[data-testid="animation-editor-popover"]')`,
              )),
              "Popup editor removed",
            );
            ctx.assert(
              !(await ctx.eval(
                `document.body.innerText.includes('Selected animation properties')`,
              )),
              "Duplicate tab removed",
            );
            ctx.assert(
              (await readFile(project + file, "utf8")) === applied,
              "Navigation preserves exact source",
            );
            await ctx.waitFor(`JSON.stringify([...document.querySelectorAll('[data-owner-id="subtitle"][data-timeline-property]')].map(row=>row.dataset.timelineProperty))==='["opacity"]'`);
            ctx.assert(await ctx.eval(`JSON.stringify([...document.querySelectorAll('[data-owner-id="subtitle"][data-timeline-property]')].map(row=>row.dataset.timelineProperty))==='["opacity"]'`), "Default timeline shows only authored opacity channel");
            ctx.assert(await ctx.eval(`getComputedStyle(document.querySelector('[data-semantic-motion-id] button[aria-label="Locate effect in timeline"]')).fontSize==='14px'`), "Effect heading uses 14px hierarchy");
            await exportAndReturn(ctx);
            await stable(ctx);
          },
          screenshot: {
            name: "layers-inline-effect",
            requireText: ["Layers"],
            rejectText: ["Something went wrong", "Selected animation properties"],
          },
        }),
    },
    {
      name: "Timeline property links to Layers",
      run: (ctx) =>
        ctx.prove(
          "A timeline opacity key selects its inline property editor and preserves other layer motion",
          {
            voiceover: vo[2],
            action: async () => {
              const r = await rect(ctx, '[role="separator"][aria-label="Resize rows"]');
              await mouse(ctx, "mousePressed", r.x + r.width / 2, r.y + r.height / 2);
              await mouse(ctx, "mouseMoved", r.x + r.width / 2, 300);
              await mouse(ctx, "mouseReleased", r.x + r.width / 2, 300);
              if (
                await ctx.eval(`!!document.querySelector('button[aria-label="Expand Subtitle"]')`)
              )
                await ctx.trustedClick('button[aria-label="Expand Subtitle"]');
              await ctx.waitFor(
                `!!document.querySelector('[data-owner-id="subtitle"][data-timeline-property="opacity"] [data-keyframe-percentage="100"]')`,
              );
              await ctx.trustedClick(
                '[data-owner-id="subtitle"][data-timeline-property="opacity"] [data-keyframe-percentage="100"]',
              );
              const input =
                '[data-owner-id="subtitle"][data-timeline-property="opacity"] input[aria-label="opacity keyframe value at 100%"]';
              await ctx.trustedClick(input);
              await ctx.fill(input, "80");
              await enter(ctx);
            },
            assert: async () => {
              manual = await witness(
                ctx,
                file,
                `Number(document.querySelector('[data-owner-id="subtitle"][data-timeline-property="opacity"] input[aria-label="opacity keyframe value at 100%"]')?.value)===80`,
                (s) => /opacity:\s*0.8/.test(s),
              );
              await seek(ctx, 1.5, 8);
              await ctx.waitFor(
                `document.querySelector('[data-layer-effect-property="opacity"][data-selected="true"] input')?.value==='80'`,
              );
              ctx.assert(
                await ctx.eval(`document.querySelectorAll('[data-semantic-motion-id]').length===1`),
                "One semantic effect card after channel edits",
              );
              fromTimeline = manual;
              const layerInput =
                '[data-layer-effect-property="opacity"][data-selected="true"] input';
              await ctx.trustedClick(layerInput);
              await ctx.fill(layerInput, "70");
              await enter(ctx);
              manual = await witness(
                ctx,
                file,
                `Number(document.querySelector('[data-owner-id="subtitle"][data-timeline-property="opacity"] input[aria-label="opacity keyframe value at 100%"]')?.value)===70`,
                (s) => /opacity:\s*0.7/.test(s),
              );
              ctx.assert(
                await ctx.eval(
                  `getComputedStyle(document.querySelector('[data-layer-effect-property="opacity"][data-selected="true"]')).backgroundColor!=='rgba(0, 0, 0, 0)'`,
                ),
                "Selected property visibly highlighted",
              );
              const now = await otherValues(ctx);
              ctx.assert(
                now?.every((v, i) => Math.abs(v - otherBefore[i]) < 0.01),
                "Original title position scale rotation opacity unchanged",
              );
              ctx.assert(await ctx.eval(`JSON.stringify([...document.querySelectorAll('[data-owner-id="subtitle"][data-timeline-property]')].map(row=>row.dataset.timelineProperty))==='["opacity"]'`), "Manual keys retain only the authored opacity row");
              ctx.assert(await ctx.eval(`getComputedStyle(document.querySelector('[data-layer-effect-property="opacity"] button')).fontSize==='13px'`), "Property label uses 13px hierarchy");
              await exportAndReturn(ctx);
              await stable(ctx);
            },
            screenshot: {
              name: "timeline-layer-property-link",
              requireText: ["Layers", "Opacity"],
              rejectText: ["Something went wrong"],
            },
          },
        ),
    },
    {
      name: "Preserve manual keys and undo",
      run: (ctx) =>
        ctx.prove(
          "Manual keys remain protected from template rebuilding and undo restores the original effect",
          {
            voiceover: vo[3],
            action: async () => {
              await ctx.trustedClick('button[aria-label="Animation"]');
              await ctx.eval(`document.querySelector('${card}')?.scrollIntoView({block:'center'})`);
              await ctx.trustedClick(`${card} [data-animation-action="edit"]`);
            },
            assert: async () => {
              ctx.assert(
                (await readFile(project + file, "utf8")) === manual,
                "Reopening effect keeps manually edited keyframes exact",
              );
              await ctx.waitFor(
                `!!document.querySelector('[data-testid="manual-motion-preserved"]')`,
              );
              await stable(ctx);
              await ctx.trustedClick('[data-semantic-motion-id][data-selected="true"] [data-slot="collapsible-trigger"]');
              ctx.assert(
                await ctx.eval(
                  `!!document.querySelector('[data-semantic-motion-id] fieldset[disabled]')`,
                ),
                "Template controls protect manual keys",
              );
              ctx.assert(
                await ctx.eval(
                  `document.querySelectorAll('[data-semantic-motion-id] fieldset[disabled] [role="slider"]:not([aria-disabled="true"])').length===0`,
                ),
                "Custom template sliders are disabled too",
              );
              const lockedSlider = '[data-semantic-motion-id] fieldset[disabled] [role="slider"]';
              const lockedValue = await ctx.eval(
                `document.querySelector('${lockedSlider}')?.getAttribute('aria-valuenow')`,
              );
              const lockedRect = await rect(ctx, lockedSlider);
              await mouse(
                ctx,
                "mousePressed",
                lockedRect.x + lockedRect.width * 0.8,
                lockedRect.y + lockedRect.height / 2,
              );
              await mouse(
                ctx,
                "mouseReleased",
                lockedRect.x + lockedRect.width * 0.8,
                lockedRect.y + lockedRect.height / 2,
              );
              ctx.assert(
                (await ctx.eval(
                  `document.querySelector('${lockedSlider}')?.getAttribute('aria-valuenow')`,
                )) === lockedValue,
                "Protected slider ignores clicks",
              );
              ctx.assert(
                (await readFile(project + file, "utf8")) === manual,
                "Protected slider never rewrites manual motion",
              );
              const response = await ctx.eval(`(async()=>{const r=await fetch('/api/projects/${encodeURIComponent(new URL(studioUrl).hash.split('/')[1].split('?')[0])}/gsap-mutations/${encodeURIComponent(file)}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'mutate-motion',operation:'upsert',targetSelector:'#subtitle',elementId:'subtitle',hfId:'subtitle',targetKind:'text',phase:'enter',presetId:'text.enter.fade',templateId:'general-fade-in',applicationKind:'general',duration:2,parameters:{intensity:2}})});return {status:r.status,body:await r.json()}})()`, { awaitPromise: true });
              ctx.assert(response.status === 409 && response.body.code === 'manual-motion-preserved', `Server rejects rebuilding manually edited motion even beyond disabled controls: ${response.status} ${JSON.stringify(response.body)}`);
              ctx.assert((await readFile(project + file, 'utf8')) === manual, 'Rejected template update preserves exact saved source');
              await reopen(ctx);
              await stable(ctx);
              await ctx.waitFor(`!!document.querySelector(${JSON.stringify(subtitle)})`);
              await ctx.trustedClick(subtitle);
              await ctx.waitFor(`!!document.querySelector('[data-testid="manual-motion-preserved"]')`);
              ctx.assert((await readFile(project + file, 'utf8')) === manual, 'Reloading the editor preserves manual keys and protection');
              await ctx.trustedClick('button[aria-label="Undo"]');
              await witness(
                ctx,
                file,
                `!!document.querySelector('${subtitle}')`,
                (s) => s === fromTimeline,
              );
              await ctx.trustedClick('button[aria-label="Undo"]');
              await witness(
                ctx,
                file,
                `!!document.querySelector('${subtitle}')`,
                (s) => s === applied,
              );
              ctx.assert(
                (await readFile(project + file, "utf8")) === applied,
                "Two undos restore both independent property edits",
              );
              await ctx.trustedClick('button[aria-label="Redo"]');
              await witness(ctx, file, `!!document.querySelector(${JSON.stringify(subtitle)})`, s => s === fromTimeline);
              await ctx.trustedClick('button[aria-label="Redo"]');
              await witness(ctx, file, `!!document.querySelector(${JSON.stringify(subtitle)})`, s => s === manual);
              await reopen(ctx);
              await stable(ctx);
              await ctx.waitFor(`!!document.querySelector(${JSON.stringify(subtitle)})`);
              await ctx.trustedClick(subtitle);
              await ctx.waitFor(`!!document.querySelector('[data-testid="manual-motion-preserved"]')`);
              ctx.assert((await readFile(project + file, 'utf8')) === manual, 'Redo and reopening restore exact manual source');
              await stable(ctx);
            },
            screenshot: {
              name: "preserved-keys-and-undo",
              requireText: ["Layers"],
              rejectText: ["Something went wrong"],
            },
          },
        ),
    },
    {
      name: "Choose property and record its first keyframe",
      run: ctx => ctx.prove("Property choice records the current value in one channel and preserves manual animation", {
        voiceover: vo[4],
        action: async () => {
          await seek(ctx, 1.5, 8);
          await ctx.trustedClick(subtitle);
          await ctx.eval(`document.querySelector('button[aria-label="Choose an animation property"]').focus()`);
          for (const type of ['keyDown','keyUp']) await ctx.client.send('Input.dispatchKeyEvent',{type,key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
          await ctx.waitFor(`!!document.activeElement?.getAttribute('data-property-choice')`);
          for (const type of ['keyDown','keyUp']) await ctx.client.send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
          await ctx.waitFor(`document.activeElement===document.querySelector('button[aria-label="Choose an animation property"]')&&document.activeElement.getAttribute('aria-expanded')==='false'`);
          await ctx.trustedClick('button[aria-label="Choose an animation property"]');
          await ctx.waitFor(`!!document.querySelector('[data-property-choice="rotation"]')`);
          await ctx.trustedClick('[data-property-choice="rotation"]');
        },
        assert: async () => {
          await ctx.waitFor(`!!document.querySelector('[data-owner-id="subtitle"][data-timeline-property="rotation"]')`);
          await witness(ctx,file,`document.querySelectorAll('[data-owner-id="subtitle"][data-timeline-property="rotation"] [data-keyframe-time]').length===1`, s=>s!==manual);
          afterProperty = await readFile(project+file,'utf8');
          ctx.assert(await ctx.eval(`document.querySelectorAll('[data-owner-id="subtitle"][data-timeline-property="rotation"] [data-keyframe-time]').length===1`), 'Choosing rotation records exactly one point at the playhead');
          ctx.assert(await ctx.eval(`!document.querySelector('[data-owner-id="subtitle"][data-timeline-property="scale"]')`), 'Unchosen empty channels remain hidden');
          await ctx.trustedClick('[data-layer-effect-property="opacity"] button');
          await seek(ctx, 1.5, 8);
          await ctx.waitFor(`document.querySelector('[data-layer-effect-property="opacity"]')?.dataset.valueContext==='keyframe'`);
          ctx.assert(await ctx.eval(`!document.querySelector('[aria-label$="add keyframe at playhead"]')`), 'Property rows have no duplicate recording action');
          await ctx.trustedClick('[data-layer-effect-property="opacity"] button');
          await ctx.waitFor(`document.querySelector('[data-layer-effect-property="opacity"]')?.dataset.valueContext==='keyframe'`);
          ctx.assert(await ctx.eval(`document.querySelector('[data-layer-effect-property="opacity"] input')?.value==='70'&&!document.querySelector('[data-layer-effect-property="opacity"] input')?.disabled`), 'Selecting a key shows its authored value and enables editing');
          await ctx.trustedClick('[data-testid="continue-manual-keyframes"]');
          ctx.assert((await readFile(project + file, 'utf8')) === afterProperty, 'Continue editing only locates the preserved manual animation');
          await stable(ctx);
        },
        screenshot: {name:'property-choice-and-value-context',requireText:['Keyframe value','Manual editing'],rejectText:['Something went wrong']},
      }),
    },
    {
      name: "Record one chosen channel and edit its time",
      run: ctx => ctx.prove("A chosen empty property records independent points and allows precise time edits without touching preset keys", {
        voiceover: vo[5],
        action: async () => {
          await seek(ctx, 1.5, 8);
          await ctx.trustedClick('[data-testid="add-property-keyframe"]');
          await witness(ctx,file,`document.querySelectorAll('[data-owner-id="subtitle"][data-timeline-property="rotation"] [data-keyframe-time]').length===1`, s=>s===afterProperty);
          ctx.assert((await readFile(project+file,'utf8'))===afterProperty,'Recording at an existing time selects the point without overwriting it');
          await seek(ctx, 2.5, 8);
          await ctx.trustedClick('[data-testid="add-property-keyframe"]');
          await ctx.waitFor(`document.querySelectorAll('[data-owner-id="subtitle"][data-timeline-property="rotation"] [data-keyframe-time]').length===2`);
          await ctx.trustedClick('[data-owner-id="subtitle"][data-timeline-property="rotation"] [data-keyframe-time="2.5"]');
          const time='[data-owner-id="subtitle"][data-timeline-property="rotation"] input[aria-label^="rotation keyframe time"]';
          await ctx.trustedClick(time);
          const beforeInvalid=await readFile(project+file,'utf8');
          await ctx.fill(time,'2.8');
          await enter(ctx);
          await ctx.waitFor(`document.querySelector(${JSON.stringify(time)})?.value==='2.5'`);
          ctx.assert((await readFile(project+file,'utf8'))===beforeInvalid,'Out-of-range time restores the saved value and never writes');
          await ctx.trustedClick(time);
          await ctx.fill(time,'2.3');
          await enter(ctx);
        },
        assert: async () => {
          await ctx.waitFor(`!!document.querySelector('[data-owner-id="subtitle"][data-timeline-property="rotation"] [data-keyframe-time="2.3"]')`);
          ctx.assert(await ctx.eval(`[...document.querySelectorAll('[data-owner-id="subtitle"][data-timeline-property="rotation"] [data-keyframe-time]')].some(e=>Math.abs(Number(e.dataset.keyframeTime)-1.5)<0.0001)`), 'Moving one point preserves its sibling time');
          ctx.assert(await ctx.eval(`JSON.stringify([...document.querySelectorAll('[data-owner-id="subtitle"][data-timeline-property="opacity"] [data-keyframe-time]')].map(e=>Number(e.dataset.keyframeTime)))==='[0,0.65]'`), 'Preset opacity keys keep their exact timing');
          await seek(ctx, 1.5, 8);
          ctx.assert(await ctx.eval(`Math.abs(Number(${frame}.contentWindow.gsap.getProperty(${frame}.contentDocument.querySelector('#subtitle'),'opacity'))-0.7)<0.001`), 'Manually edited opacity survives new rotation animation');
          const now=await otherValues(ctx);
          ctx.assert(now?.every((v,i)=>Math.abs(v-otherBefore[i])<0.01),'Unrelated title animation unchanged');
          await stable(ctx);
        },
        screenshot: {name:'chosen-property-and-time-edit',requireText:['Manual editing','Keyframe value'],rejectText:['Something went wrong']},
      }),
    },
    {
      name: "Record X and preserve an edited point",
      run: ctx => ctx.prove("Selecting X records immediately; the toolbar continues recording and never overwrites a manual point", {
        voiceover: vo[6],
        action: async () => {
          await seek(ctx, 1.5, 8);
          await ctx.trustedClick(subtitle);
          await ctx.trustedClick('button[aria-label="Choose an animation property"]');
          await ctx.trustedClick('[data-property-choice="x"]');
          await ctx.waitFor(`document.querySelectorAll('[data-owner-id="subtitle"][data-timeline-property="x"] [data-keyframe-time]').length===1`);
          await seek(ctx, 3, 8);
          await ctx.trustedClick('[data-testid="add-property-keyframe"]');
          await ctx.waitFor(`document.querySelectorAll('[data-owner-id="subtitle"][data-timeline-property="x"] [data-keyframe-time]').length===2`);
          await ctx.trustedClick('[data-owner-id="subtitle"][data-timeline-property="x"] [data-keyframe-time="3"]');
          const value='[data-owner-id="subtitle"][data-timeline-property="x"] input[aria-label^="x keyframe value"]';
          const beforeXEdit=await readFile(project+file,'utf8');
          await ctx.trustedClick(value);
          await ctx.fill(value,'80');
          await enter(ctx);
          await witness(ctx,file,`document.querySelector(${JSON.stringify(value)})?.value==='80'`, source=>source!==beforeXEdit && /x:\s*80/.test(source));
          const beforeRepeat=await readFile(project+file,'utf8');
          await ctx.trustedClick('[data-testid="add-property-keyframe"]');
          await stable(ctx);
          ctx.assert((await readFile(project+file,'utf8'))===beforeRepeat,'Recording at an existing manually edited point never overwrites its value');
          await seek(ctx,2.5,8);
        },
        assert: async () => {
          await ctx.waitFor(`(()=>{const x=Number(${frame}.contentWindow.gsap.getProperty(${frame}.contentDocument.querySelector('#subtitle'),'x'));return x>0&&x<80})()`);
          await seek(ctx,3,8);
          await ctx.waitFor(`Math.abs(Number(${frame}.contentWindow.gsap.getProperty(${frame}.contentDocument.querySelector('#subtitle'),'x'))-80)<0.1`);
          await seek(ctx,1.5,8);
          await ctx.waitFor(`Math.abs(Number(${frame}.contentWindow.gsap.getProperty(${frame}.contentDocument.querySelector('#subtitle'),'x')))<0.1`);
          await seek(ctx,2.5,8);
          ctx.assert(await ctx.eval(`Math.abs(Number(${frame}.contentWindow.gsap.getProperty(${frame}.contentDocument.querySelector('#subtitle'),'opacity'))-0.7)<0.001`), 'New X animation preserves the manually edited opacity');
          ctx.assert(await ctx.eval(`!!document.querySelector(${JSON.stringify(subtitle)}+' [data-testid="timeline-keyframe-overlay"]')&&!document.querySelector('[data-testid="timeline-animation-overlay"]')`), 'The owner thumbnail carries keyframe marks instead of animation strips');
          await stable(ctx);
        },
        screenshot: {name:'toolbar-x-recording',requireText:['Subtitle'],rejectText:['Something went wrong']},
      }),
    },
  ],
};
