// Controlled gesture evidence + production server/panel/GSAP. Native ONNX has a separate witness.
import { connect, listTargets, debuggerUrlFor } from "../runner/cdp.mjs";
const preview = "document.querySelector('[data-testid=enhancement-preview]')";
const witness = ctx => ctx.eval("fetch('http://127.0.0.1:5388/witness').then(r=>r.json())", { awaitPromise: true });
async function activate(ctx, selector) {
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)})) && !document.querySelector(${JSON.stringify(selector)}).disabled`);
  await ctx.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);
  await ctx.trustedClick(selector);
}
async function ready(ctx) {
  await ctx.waitFor(`${preview}?.srcdoc && !document.body.innerText.includes('更新预览') && Boolean(document.querySelector('[aria-label="播放预览"]:not(:disabled)'))`, { timeoutMs: 30000 });
}
async function changed(ctx, action) {
  const before = await ctx.eval(`${preview}.srcdoc`);
  await action();
  await ctx.waitFor(`${preview}.srcdoc!==${JSON.stringify(before)}`, { timeoutMs: 30000 });
  await ready(ctx);
}
async function cards(ctx) {
  const base = ctx.cdpBaseUrl;
  const frame = (await listTargets(base)).find(target => target.type === "iframe" && target.url === "about:srcdoc");
  ctx.assert(Boolean(frame), "Production sandbox preview frame exists");
  const client = await connect(debuggerUrlFor(base, frame));
  try {
  const response = await client.send("Runtime.evaluate", { returnByValue: true,
    expression: `Array.from(document.querySelectorAll('.enhancement-card')).map(e=>({id:e.id,kind:e.dataset.kind,binding:e.dataset.binding,time:Number(e.dataset.anchorTime),x:parseFloat(e.style.left)/100,y:parseFloat(e.style.top)/100,opacity:Number(getComputedStyle(e).opacity),clip:getComputedStyle(e).clipPath,text:e.textContent}))` });
  return response.result.value;
  } finally { client.close(); }
}
async function seek(ctx, time) {
  await ctx.fill('[aria-label="预览播放位置"]', String(time));
  await ctx.waitFor(`Math.abs(Number(document.querySelector('[aria-label="预览播放位置"]').value)-${time})<.02`);
  // Wait on rendered style in a separate read; seeking may complete after React updates the slider.
  await ctx.eval("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))", { awaitPromise: true });
  return cards(ctx);
}
async function select(ctx, id) {
  await activate(ctx, '[data-testid="enhancement-content-tab"]');
  await activate(ctx, `[data-testid="enhancement-cue"]:has([aria-label="${id} 启用片段"]) button`);
}
export default { id: "video-gesture-binding", title: "手势绑定、托举与引导 · 受控轨迹的真实预览", kind: "user-facing", preserveTheme: true,
  cdpTarget: { urlIncludes: "127.0.0.1:5368/tests/video-enhancement-proof.html" },
  steps: [{ name: "逐词位置与连续动效", async run(ctx) {
    await ctx.client.send("Page.reload");
    await ctx.waitFor("Boolean(window.__ipolloworkControl)");
    await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await ctx.client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await ctx.prove("这里的词语时间锁定指向位置，缺少数据时展示可编辑占位图", {
      voiceover: "说到这里时，数据图固定在指向位置；没有真实数值时显示占位图，稍后可以补充。此验证使用受控轨迹。",
      action: async () => { await activate(ctx, '[data-testid="video-enhancement-open"]'); await ready(ctx); await select(ctx, "enhance-1"); await seek(ctx, .7); },
      assert: async () => {
        const first = (await cards(ctx)).find(card => card.id === "enhance-1");
        ctx.assert(first.binding === "locked" && first.time === .3 && first.opacity > .9, "Rendered card is locked to the measured word time");
        const later = (await seek(ctx, 1.4)).find(card => card.id === "enhance-1");
        ctx.assert(Math.abs(first.x - later.x) < .001 && first.text.includes("待补充数据"), "Point does not chase later finger movement or invent chart values");
        ctx.assert((await witness(ctx)).html.includes("增强前时间轴"), "Preview leaves the timeline intact");
      }, screenshot: { name: "word-point-lock", requireText: ["指向锁定", "词语", "当前显示占位图"] } });
    await ctx.prove("托举跟随实测轨迹，轨迹结束后停住，倒退预览可复现位置", {
      voiceover: "掌心托举时内容平滑跟随，手势丢失后停在最后可靠位置，倒退拖动也能复现相同位置。",
      action: async () => { await select(ctx, "enhance-2"); await seek(ctx, 2.4); },
      assert: async () => {
        const early = (await cards(ctx)).find(card => card.id === "enhance-2");
        const late = (await seek(ctx, 3.2)).find(card => card.id === "enhance-2");
        ctx.assert(early.binding === "follow" && late.x > early.x + .04, "Actual GSAP preview follows the palm");
        const stop = (await seek(ctx, 3.6)).find(card => card.id === "enhance-2");
        const held = (await seek(ctx, 3.7)).find(card => card.id === "enhance-2");
        ctx.assert(Math.abs(stop.x - held.x) < .001, "No extrapolation after measured tracking ends");
        const rewind = (await seek(ctx, 2.4)).find(card => card.id === "enhance-2");
        ctx.assert(Math.abs(rewind.x - early.x) < .001, "Backward seeking reconstructs the same position");
      }, screenshot: { name: "palm-follow", requireText: ["托举跟随", "掌心托着"] } });
    await ctx.prove("引导按移动方向展开，双手展示使用两手之间的区域", {
      voiceover: "横向引导让内容沿手掌方向展开，双手展示把对比内容放在两只手之间。",
      action: async () => { await select(ctx, "enhance-3"); await seek(ctx, 4.3); },
      assert: async () => {
        const early = (await cards(ctx)).find(card => card.id === "enhance-3");
        const late = (await seek(ctx, 5.65)).find(card => card.id === "enhance-3");
        ctx.assert(early.binding === "reveal" && early.clip !== late.clip && late.clip.includes("0%"), "Actual clip mask reveals over the measured guide window");
        await select(ctx, "enhance-4");
        const framed = (await seek(ctx, 6.5)).find(card => card.id === "enhance-4");
        ctx.assert(framed.binding === "frame" && Math.abs(framed.x - .34) < .01, "Comparison is centered between both hands");
      }, screenshot: { name: "two-hand-region", requireText: ["双手展示", "双手展示对比"] } });
    await ctx.prove("用户可以补充图表数据并锁定校正位置，应用与 AI 编排保留相同约束", {
      voiceover: "补充真实数据并手动锁定位置后，基础版和 AI 编排请求都会保留图表、位置和逐词时间。",
      action: async () => {
        await select(ctx, "enhance-1");
        await changed(ctx, () => ctx.clickText("添加数据"));
        await changed(ctx, () => ctx.fill('[aria-label="enhance-1 数据标签 1"]', "增长"));
        await changed(ctx, () => ctx.fill('[aria-label="enhance-1 数据值 1"]', "30"));
        await changed(ctx, () => activate(ctx, '[aria-label="enhance-1 锁定位置"]'));
        await changed(ctx, () => ctx.fill('[aria-label="enhance-1 位置 x"]', "70"));
        await seek(ctx, .8);
      }, assert: async () => {
        const corrected = (await cards(ctx)).find(card => card.id === "enhance-1");
        ctx.assert(corrected.binding === "manual" && Math.abs(corrected.x - .54) < .001 && corrected.text.includes("30"), "Corrected chart is visibly rendered at the locked coordinate");
        await activate(ctx, '[data-testid="enhancement-apply"]');
        await ctx.waitFor("document.body.innerText.includes('基础版已应用')");
        const saved = await witness(ctx);
        ctx.assert(saved.html.includes('data-binding="follow"') && saved.html.includes('clipPath:"inset(0 100% 0 0)"'), "Editable timeline retains support and reveal animations");
        await activate(ctx, '[data-testid="enhancement-generate"]');
        await ctx.waitFor("window.__enhancementWorkflowRequests.length===1");
        const request = await ctx.eval("window.__enhancementWorkflowRequests[0]");
        const payload = await ctx.eval(`fetch('http://127.0.0.1:5388/files/'+${JSON.stringify(request.requestPath)}).then(r=>r.json())`, { awaitPromise: true });
        ctx.assert(payload.timingPrecision === "word" && payload.words.length === 4, "AI request contains measured words");
        ctx.assert(payload.cues[0].anchor.x === .7 && payload.cues[0].chart[0].value === 30 && payload.cues[1].binding.behavior === "follow", "AI handoff retains editable data and deterministic motion bindings");
      }, screenshot: { name: "chart-correction-handoff", requireText: ["未调用模型", "当前对话入口"] } });
  } }],
};
