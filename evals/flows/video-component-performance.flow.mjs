export default {
  id: "video-component-performance",
  title: "Multi-component Studio playback and static component covers",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "#project/" },
  preserveTheme: true,
  steps: [{ name: "Play, seek and browse the existing component video", async run(ctx) {
    await ctx.waitFor("(() => {const p=document.querySelector('hyperframes-player');return document.querySelectorAll('hyperframes-player').length===1 && p?.ready && p.assetsReady && p.painted})()", { timeoutMs: 45000, label: "Painted component video with loaded assets" });
    const source = await ctx.eval(`(() => { const p=document.querySelector('hyperframes-player');const d=p.iframeElement?.contentDocument;return {duration:p.duration,components:d?.querySelectorAll('[data-ipw-registry-component^="stage-"]').length}; })()`);
    ctx.assert(source.components >= 2, "The actual video contains multiple Stage components");
    await ctx.prove("多个商业组件的整片预览持续推进，不因文字动画反复重建图层", {
      voiceover: "这支视频使用多个商业组件。点击播放后，画面与时间轴正常推进，文字动画不会拖慢整个工作台。",
      action: async () => {
        await ctx.eval("document.querySelector('hyperframes-player').muted=true;document.querySelector('hyperframes-player').seek(0)");
        await ctx.trustedClick('button[aria-label="图层"],button[aria-label="Layers"]');
        await ctx.trustedClick(".hf-studio-play-control");
      },
      assert: async () => {
        await ctx.client.send("Performance.enable");
        const metrics = async () => Object.fromEntries((await ctx.client.send("Performance.getMetrics")).metrics.map(m => [m.name,m.value]));
        const before = await metrics();
        const sample = await ctx.eval(`new Promise(resolve=>{const p=document.querySelector('hyperframes-player'),start=p.currentTime,ts=[];let raf;function tick(t){ts.push(t);raf=requestAnimationFrame(tick)}raf=requestAnimationFrame(tick);setTimeout(()=>{cancelAnimationFrame(raf);const gaps=ts.slice(1).map((t,i)=>t-ts[i]);resolve({frames:ts.length,advance:p.currentTime-start,maxGap:Math.max(0,...gaps),paused:p.paused})},4000)})`, { awaitPromise: true });
        const after = await metrics();
        ctx.output("Four-second playback sample", JSON.stringify({ ...sample,scriptSeconds:after.ScriptDuration-before.ScriptDuration,taskSeconds:after.TaskDuration-before.TaskDuration, ...source }));
        ctx.assert(sample.advance >= 3.2 && !sample.paused, "Video advances at ordinary speed");
        ctx.assert(sample.frames >= 80, "The UI delivers at least 20 animation frames per second");
        const visible = await ctx.eval(`(() => {const p=document.querySelector('hyperframes-player'),w=p.iframeElement.contentWindow,d=p.iframeElement.contentDocument;const hosts=[...d.querySelectorAll('[data-ipw-registry-component^="stage-"]')];return {errors:w.__hfPreviewErrors?.length??0,painted:hosts.some(n=>w.getComputedStyle(n).visibility==='visible' && Number(w.getComputedStyle(n).opacity)>.5)}})()`);
        ctx.assert(visible.painted && visible.errors===0, "The advancing video actually paints a component without runtime errors");
      },
      screenshot: { name: "component-playback", rejectText: ["Loading composition", "Loading assets"] },
    });
    await ctx.prove("前后拖动后同一镜头保持一致，组件列表使用静态封面", {
      voiceover: "拖回前一镜，再定位到中间镜头，画面保持一致。组件列表直接显示封面，浏览时不用启动一组动画网页。",
      action: async () => {
        await ctx.trustedClick(".hf-studio-play-control");
        await ctx.eval(`(() => {const p=document.querySelector('hyperframes-player');p.seek(Math.min(32,p.duration/2));})()`);
        await ctx.eval("new Promise(r=>setTimeout(r,300))", { awaitPromise: true });
        const fingerprint = `(() => {const d=document.querySelector('hyperframes-player').iframeElement.contentDocument;return [...d.querySelectorAll('.sd-root')].map(n=>({text:n.textContent,transform:n.style.transform,opacity:n.style.opacity}))})()`;
        const first = await ctx.eval(fingerprint);
        await ctx.eval("document.querySelector('hyperframes-player').seek(.5)");
        await ctx.eval(`(() => {const p=document.querySelector('hyperframes-player');p.seek(Math.min(32,p.duration/2));})()`);
        await ctx.eval("new Promise(r=>setTimeout(r,300))", { awaitPromise: true });
        ctx.assert(JSON.stringify(first) === JSON.stringify(await ctx.eval(fingerprint)), "Reverse/direct seeking produces the same scene");
        await ctx.trustedClick('button[aria-label="组件"],button[aria-label="Components"]');
        await ctx.waitFor("Boolean(document.querySelector('[data-block-name=\"stage-tree\"]'))", { timeoutMs: 15000 });
        await ctx.eval("document.querySelector('[data-block-name=\"stage-tree\"]').scrollIntoView({block:'center'})");
        await ctx.waitFor("Boolean(document.querySelector('[data-block-name=\"stage-tree\"] img')?.naturalWidth)", { timeoutMs: 15000 });
      },
      assert: async () => {
        const state = await ctx.eval(`(() => {const cards=[...document.querySelectorAll('[data-block-name^="stage-"]')];return {cards:cards.length,covers:cards.filter(c=>c.querySelector('img[src^="data:image/webp"]')).length,frames:document.querySelectorAll('iframe[src*="/registry/blocks/stage-"]').length}})()`);
        ctx.output("Component cover witness", JSON.stringify(state));
        ctx.assert(state.cards === 35 && state.covers > 0 && state.frames === 0, "35 components are available and visible covers require no Stage iframe");
      },
      screenshot: { name: "static-component-covers", rejectText: ["Loading composition", "Loading assets"] },
    });
    let sceneChecks;
    await ctx.prove("每个商业组件镜头都能显示，不再留下透明的空画面", {
      voiceover: "逐一检查全部镜头的中间位置。每次只显示当前场景，组件内容可见，运行时没有报错。",
      action: async () => {
        sceneChecks = await ctx.eval(`(async()=>{const p=document.querySelector('hyperframes-player'),d=p.iframeElement.contentDocument;const manifest=p.iframeElement.contentWindow.__clipManifest;const shots=[...d.querySelectorAll('[data-ipw-registry-component^="stage-"]')].map(n=>{const c=manifest.clips.find(c=>c.id===n.id);if(!c)throw Error('Missing scene timing');return {id:n.id,time:c.start+c.duration/2}});const checks=[];for(const shot of shots){p.seek(shot.time);await new Promise(r=>setTimeout(r,150));const w=p.iframeElement.contentWindow;checks.push({...shot,errors:w.__hfPreviewErrors?.length??0,visible:[...p.iframeElement.contentDocument.querySelectorAll('[data-ipw-registry-component^="stage-"]')].filter(n=>w.getComputedStyle(n).visibility==='visible'&&Number(w.getComputedStyle(n).opacity)>.5).map(n=>n.id)})}return checks})()`, { awaitPromise: true });
      },
      assert: async () => {
        ctx.output("Every scene midpoint", JSON.stringify(sceneChecks));
        ctx.assert(sceneChecks.length===source.components && sceneChecks.every(s=>s.errors===0 && s.visible.length===1 && s.visible[0]===s.id), "Every scene paints only its own component without runtime errors");
      },
      screenshot: { name: "all-scenes-visible", rejectText: ["Loading composition", "Loading assets"] },
    });
  } }],
};
