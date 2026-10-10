import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
const vo = await loadVoiceoverParagraphs("video-local-enhancement");
const frameExpression = "(() => { const html=document.querySelector('[data-testid=enhancement-preview]')?.srcdoc; if(!html)return null; const doc=new DOMParser().parseFromString(html,'text/html'),root=doc.querySelector('[data-composition-id]'),v=doc.querySelector('video'); const rect=e=>({x:parseFloat(e.style.left)/100,y:parseFloat(e.style.top)/100,width:parseFloat(e.style.width)/100,height:parseFloat(e.style.height)/100}); return {mode:root.dataset.enhancementLayout,width:Number(root.dataset.width),height:Number(root.dataset.height),source:rect(v),cards:[...doc.querySelectorAll('.enhancement-card')].map(e=>({id:e.id,kind:e.dataset.kind,text:e.textContent,rect:rect(e)}))}; })()";
const key = (ctx, key, code, value) => ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: value, ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : key === " " ? { text: " ", unmodifiedText: " " } : {}) }).then(() => ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: value }));
async function activate(ctx, selector) {
  await ctx.waitFor("(() => { const e=document.querySelector("+JSON.stringify(selector)+");return e && !e.disabled; })()");
  await ctx.eval("document.querySelector("+JSON.stringify(selector)+").scrollIntoView({block:'nearest'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))", { awaitPromise: true });
  await ctx.trustedClick(selector);
}
async function choose(ctx, selector, value) {
  const index = await ctx.eval("Array.from(document.querySelector(" + JSON.stringify(selector) + ").options).findIndex(o=>o.value===" + JSON.stringify(value) + ")");
  ctx.assert(index >= 0, "Requested choice exists: " + value);
  await ctx.eval("document.querySelector(" + JSON.stringify(selector) + ").focus()");
  await key(ctx, " ", "Space", 32);
  await ctx.waitFor("document.activeElement===document.querySelector(" + JSON.stringify(selector) + ")", { label: "focused native select" });
  await key(ctx, "Home", "Home", 36);
  for (let i = 0; i < index; i++) await key(ctx, "ArrowDown", "ArrowDown", 40);
  await key(ctx, "Enter", "Enter", 13);
  await ctx.waitFor("document.querySelector(" + JSON.stringify(selector) + ").value===" + JSON.stringify(value));
}
async function changed(ctx, action) {
  await ctx.eval("window.__fraimzPreviousPreview=document.querySelector('[data-testid=enhancement-preview]')?.srcdoc;true");
  await action();
  await ctx.waitFor("document.querySelector('[data-testid=enhancement-preview]')?.srcdoc!==window.__fraimzPreviousPreview && !document.body.innerText.includes('更新预览')", { timeoutMs: 30000, label: "updated composition preview" });
}
const witness = ctx => ctx.eval("fetch('http://127.0.0.1:5288/witness').then(r=>r.json())", { awaitPromise: true });
const safe = frame => frame.cards.every(({ rect: c }) => c.x + c.width <= frame.source.x || c.x >= frame.source.x + frame.source.width || c.y + c.height <= frame.source.y || c.y >= frame.source.y + frame.source.height);
export default { id: "video-local-enhancement", title: "视频智能增强 · 内容编排与自由布局", kind: "user-facing", preserveTheme: true,
  cdpTarget: { urlIncludes: "127.0.0.1:5268/tests/video-enhancement-proof.html" },
  steps: [{ name: "分析、编排、预览、应用与响应布局", async run(ctx) {
    await ctx.eval("window.__fraimzReloadMarker=true");
    await ctx.client.send("Page.reload");
    await ctx.waitFor("!window.__fraimzReloadMarker && Boolean(window.__ipolloworkControl)");
    await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1180, height: 850, deviceScaleFactor: 1, mobile: false });
    await ctx.client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    if (await ctx.eval("Boolean(document.querySelector('[data-testid=video-enhancement-panel]'))")) await activate(ctx, '[data-slot="dialog-close"]');
    const setup = await ctx.eval("fetch('http://127.0.0.1:5288/setup').then(r=>r.json())", { awaitPromise: true });
    await ctx.prove("真实口播生成内容为主体的本地横屏画面", { voiceover: vo[0], action: async () => {
      await activate(ctx, '[data-testid="video-enhancement-open"]');
      await ctx.waitFor("!document.querySelector('[data-testid=enhancement-use-gestures]').disabled");
      const saved = await ctx.eval("fetch('http://127.0.0.1:5288/witness').then(r=>r.ok?r.json():null).catch(()=>null)", { awaitPromise: true });
      if (!saved?.job?.result) {
        const doc = await ctx.client.send("DOM.getDocument");
        const node = await ctx.client.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: '[data-testid="enhancement-file"]' });
        await ctx.client.send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [setup.source] });
        await ctx.waitFor("!document.querySelector('[data-testid=enhancement-start]').disabled");
        await activate(ctx, '[data-testid="enhancement-start"]');
      } else ctx.output("native-analysis-reused", "Reuse the completed native local analysis while checking composition controls.");
      await ctx.waitFor("Boolean(document.querySelector('[data-testid=enhancement-preview]')) || document.body.innerText.includes('阶段失败')", { timeoutMs: 300000 });
      await ctx.waitFor("document.querySelector('[data-testid=enhancement-preview]')?.srcdoc && !document.body.innerText.includes('更新预览')", { timeoutMs: 30000 });
      if (saved?.job?.result) {
        // Repeated proofs reuse measured analysis, then reset editable settings through the UI.
        if (saved.job.status === "applied") {
          await activate(ctx, '[data-testid="enhancement-restore"]');
          await ctx.waitForText("已恢复增强前时间轴");
        }
        if ((await ctx.eval(frameExpression)).mode !== "pip") await changed(ctx, () => activate(ctx, '[data-testid="enhancement-mode-pip"]'));
        for (const [label, value] of [["画布比例", "16:9"], ["原视频位置", "bottom-left"], ["原视频大小", "medium"], ["生成内容位置", "auto"]]) {
          const selector = `[aria-label="${label}"]`;
          if (await ctx.eval("document.querySelector("+JSON.stringify(selector)+").value!=="+JSON.stringify(value))) await changed(ctx, () => choose(ctx, selector, value));
        }
        await activate(ctx, '[data-testid="enhancement-content-tab"]');
        await changed(ctx, () => activate(ctx, '[data-testid="enhancement-regenerate"]'));
        await activate(ctx, '[data-testid="enhancement-layout-tab"]');
      }
      await activate(ctx, '[aria-label="预览播放位置"]');
      await ctx.fill('[aria-label="预览播放位置"]', "1");
      await ctx.waitFor("!document.querySelector('[aria-label=\"播放预览\"]').disabled", { timeoutMs: 15000, label: "loaded preview media" });
      await activate(ctx, '[aria-label="播放预览"]');
      await ctx.waitFor("Number(document.querySelector('[aria-label=\"预览播放位置\"]').value)>1.5", { timeoutMs: 15000 });
      await activate(ctx, '[aria-label="暂停预览"]');
    }, assert: async () => {
      const state = await witness(ctx), frame = await ctx.eval(frameExpression);
      ctx.assert(state.job.status === "ready" && state.job.result.segments.length > 0, "Real local speech completed");
      ctx.assert(state.job.result.masks.some(f => f.data) && state.job.result.hands.some(f => f.boxes.length), "Real local vision completed");
      ctx.assert(frame.mode === "pip" && frame.width === 1280 && frame.height === 720, "Default is generated-content-first 16:9");
      ctx.assert(frame.source.x === .04 && frame.source.y > .5 && safe(frame), "Whole original frame is protected in the lower left");
      ctx.assert(frame.cards.some(c => c.kind === "steps") && frame.cards.some(c => c.text.length > 24), "Speech becomes structured content with retained context");
      ctx.assert(state.html.includes("增强前时间轴"), "Analysis and preview do not overwrite the timeline");
    }, screenshot: { name: "generated-content-primary", requireText: ["布局预览", "画面布局", "角落画中画"] } });
    await ctx.prove("原视频与生成内容的位置、模式和比例独立可选", { voiceover: vo[1], action: async () => {
      await changed(ctx, () => choose(ctx, '[aria-label="原视频位置"]', "top-right"));
      const small = await ctx.eval(frameExpression);
      await changed(ctx, () => choose(ctx, '[aria-label="原视频大小"]', "large"));
      ctx.assert((await ctx.eval(frameExpression)).source.height > small.source.height, "Size control changes actual source dimensions");
      await changed(ctx, () => activate(ctx, '[data-testid="enhancement-mode-background"]'));
      ctx.assert((await ctx.eval(frameExpression)).mode === "background", "Background mode reaches actual preview");
      await changed(ctx, () => choose(ctx, '[aria-label="画布比例"]', "source"));
      const source = await ctx.eval(frameExpression);
      ctx.assert(source.width === 384 && source.height === 672, "Original canvas dimensions are available");
      await changed(ctx, () => activate(ctx, '[data-testid="enhancement-mode-split"]'));
      await changed(ctx, () => choose(ctx, '[aria-label="画布比例"]', "9:16"));
      await changed(ctx, () => choose(ctx, '[aria-label="原视频位置"]', "bottom-left"));
      await changed(ctx, () => choose(ctx, '[aria-label="原视频位置"]', "bottom-right"));
      await changed(ctx, () => choose(ctx, '[aria-label="生成内容位置"]', "left"));
      const split = await ctx.eval(frameExpression);
      ctx.assert(split.mode === "split" && split.width === 720 && split.height === 1280 && safe(split), "Portrait split layout keeps content outside the original");
      await changed(ctx, () => activate(ctx, '[data-testid="enhancement-mode-pip"]'));
      await changed(ctx, () => choose(ctx, '[aria-label="画布比例"]', "16:9"));
      await changed(ctx, () => choose(ctx, '[aria-label="原视频位置"]', "top-right"));
      await changed(ctx, () => choose(ctx, '[aria-label="生成内容位置"]', "bottom"));
    }, assert: async () => {
      const frame = await ctx.eval(frameExpression);
      ctx.assert(frame.source.y === .06 && frame.source.x > .7, "Original video moved to top right");
      ctx.assert(frame.cards.every(c => c.rect.y >= .52) && safe(frame), "Content moved below without covering the original");
    }, screenshot: { name: "source-and-content-layout", requireText: ["原视频位置", "生成内容位置", "画布比例"] } });
    await ctx.prove("内容校对、样式切换、再次应用和恢复均真实落盘", { voiceover: vo[2], action: async () => {
      await changed(ctx, () => choose(ctx, '[aria-label="生成内容位置"]', "auto"));
      await activate(ctx, '[data-testid="enhancement-content-tab"]');
      await changed(ctx, () => choose(ctx, '[aria-label="enhance-1 呈现方式"]', "comparison"));
      await changed(ctx, () => ctx.fill('[aria-label="enhance-1 元素文字"]', "从想法到成果"));
      await changed(ctx, () => ctx.fill('[aria-label="enhance-1 内容条目"]', "想法进入\n"));
      ctx.assert(await ctx.eval("document.querySelector('[aria-label=\"enhance-1 内容条目\"]').value.endsWith('\\n')"), "A new line stays editable before the next item is typed");
      await changed(ctx, () => ctx.fill('[aria-label="enhance-1 内容条目"]', "想法进入\n清晰目标与可执行步骤"));
      await activate(ctx, '[data-testid="enhancement-cue"] button');
      await ctx.waitFor("!document.querySelector('[data-testid=enhancement-apply]').disabled");
      await activate(ctx, '[data-testid="enhancement-apply"]');
      await ctx.waitForText("已应用到时间轴");
      const first = await witness(ctx);
      ctx.assert(first.job.status === "applied" && first.html.includes("从想法到成果") && first.html.includes("清晰目标与可执行步骤"), "Corrected structured scene is saved");
      ctx.assert(first.html.includes('data-width="1280"') && first.html.includes('data-track-index="1"') && first.html.includes('data-volume="1"'), "Canvas, editable tracks and original audio persisted");
      await activate(ctx, '[data-testid="enhancement-layout-tab"]');
      await changed(ctx, () => choose(ctx, '[aria-label="原视频位置"]', "bottom-left"));
      await activate(ctx, '[data-testid="enhancement-apply"]');
      await ctx.waitForText("已应用到时间轴");
      await ctx.waitFor("!document.querySelector('[data-testid=enhancement-apply]').disabled");
      const second = await witness(ctx);
      ctx.assert(second.job.status === "applied" && second.html !== first.html, "An applied composition can be updated safely");
      await activate(ctx, '[data-testid="enhancement-restore"]');
      await ctx.waitForText("已恢复增强前时间轴");
      const restored = await witness(ctx);
      ctx.assert(restored.job.status === "ready" && restored.html.includes("增强前时间轴"), "First timeline backup is restored exactly");
      await activate(ctx, '[data-testid="enhancement-content-tab"]');
    }, assert: async () => { ctx.assert((await ctx.eval(frameExpression)).cards[0].kind === "comparison", "Chosen visual type remains visible in preview"); },
      screenshot: { name: "rich-content-editing", requireText: ["呈现方式", "内容条目", "已恢复增强前时间轴"] } });
    await ctx.prove("窄窗口保持预览、设置与操作清晰，分析细节默认折叠", { voiceover: vo[3], action: async () => {
      await activate(ctx, '[data-testid="enhancement-layout-tab"]');
      await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 600, height: 900, deviceScaleFactor: 1, mobile: false });
      await ctx.waitFor("document.querySelector('[data-testid=video-enhancement-panel]').getBoundingClientRect().width<600");
    }, assert: async () => {
      const geometry = await ctx.eval("(() => { const p=document.querySelector('[data-testid=video-enhancement-panel]'),r=p.getBoundingClientRect(),a=document.querySelector('[data-testid=enhancement-actions]').getBoundingClientRect(),preview=p.querySelector('section').getBoundingClientRect(),tabs=p.querySelector('[data-slot=tabs]').getBoundingClientRect(); return {fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:p.scrollWidth>p.clientWidth,actions:a.bottom<=innerHeight,noOverlap:preview.bottom<=tabs.top+.5,details:[...p.querySelectorAll('details')].every(e=>!e.open)}; })()");
      ctx.assert(geometry.fits && !geometry.overflow && geometry.actions && geometry.details && geometry.noOverlap, "Narrow viewport fits with separate preview/settings, fixed action controls and collapsed detail");
    }, screenshot: { name: "clean-narrow-dialog", requireText: ["布局预览", "应用基础版", "分析设置"] } });

    await ctx.prove("智能增强把本地证据交给直接生成视频的同一对话流程", { voiceover: vo[4], action: async () => {
      await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1180, height: 850, deviceScaleFactor: 1, mobile: false });
      await activate(ctx, '[data-testid="enhancement-generate"]');
      await ctx.waitFor("window.__enhancementWorkflowRequests.length===1 && !document.querySelector('[data-testid=video-enhancement-panel]')");
    }, assert: async () => {
      const request=await ctx.eval("window.__enhancementWorkflowRequests[0]");
      const saved=await ctx.eval("fetch('http://127.0.0.1:5288/files/'+"+JSON.stringify(request.requestPath)+").then(r=>r.json())",{awaitPromise:true});
      ctx.assert(request.sourcePath==='video/proof/index.html' && request.instruction.includes('ipollowork-video-studio'), "Current conversation receives the canonical video skill request");
      ctx.assert(saved.type==='video-enhancement' && saved.timingPrecision==='segment' && saved.original.preserveAudio && saved.segments.length>0 && saved.cues[0].kind==='comparison', "Actual local evidence, user correction and media constraints reach the shared workflow");
      ctx.assert((await witness(ctx)).html.includes('增强前时间轴'), "Preparing the AI request leaves the existing timeline intact");
      ctx.output('model-validation-scope', 'The current-conversation callback is witnessed; no model or paid media job is called by this proof.');
    }, screenshot: { name: "shared-video-skill-handoff", requireText: ["当前对话入口", "未调用模型"] } });
  } }] };
