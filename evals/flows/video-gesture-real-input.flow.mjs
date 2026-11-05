// Native Whisper/ONNX result from the user's clip; no synthetic gesture tracks.
// This proves preview placement and the AI request, not model-generated image quality.
import { connect, listTargets, debuggerUrlFor } from "../runner/cdp.mjs";
const media = "http://127.0.0.1:5488";
const witness = ctx => ctx.eval(`fetch('${media}/witness').then(r=>r.json())`, { awaitPromise: true });
async function activate(ctx, selector) {
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)})) && !document.querySelector(${JSON.stringify(selector)}).disabled`);
  await ctx.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'center'})`);
  await ctx.eval("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))", { awaitPromise: true });
  await ctx.trustedClick(selector);
}
async function rendered(ctx, time) {
  await ctx.fill('[aria-label="预览播放位置"]', String(time));
  const frame = (await listTargets(ctx.cdpBaseUrl)).find(target => target.type === "iframe" && target.url === "about:srcdoc");
  ctx.assert(Boolean(frame), "Production enhancement preview iframe exists");
  const client = await connect(debuggerUrlFor(ctx.cdpBaseUrl, frame));
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await client.send("Runtime.evaluate", { returnByValue: true, expression: `({time:document.querySelector('video').currentTime,cards:[...document.querySelectorAll('.enhancement-card')].map(e=>({id:e.id,binding:e.dataset.binding,time:Number(e.dataset.anchorTime),x:parseFloat(e.style.left)/100,y:parseFloat(e.style.top)/100,width:parseFloat(e.style.width)/100,height:parseFloat(e.style.height)/100,opacity:Number(getComputedStyle(e).opacity)}))})` });
      if (Math.abs(response.result.value.time - time) < .05) return response.result.value.cards;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Original video did not seek to the requested time");
  } finally { client.close(); }
}
export default { id: "video-gesture-real-input", title: "原视频 · 抬掌、指向与双手框选定位", kind: "user-facing", preserveTheme: true,
  cdpTarget: { urlIncludes: "127.0.0.1:5468/tests/video-enhancement-proof.html" },
  steps: [{ name: "原声恢复与三个真实手势", async run(ctx) {
    await ctx.client.send("Page.reload");
    await ctx.waitFor("Boolean(window.__ipolloworkControl)");
    await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await ctx.client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await activate(ctx, '[data-testid="video-enhancement-open"]');
    await ctx.waitFor("document.querySelector('[data-testid=enhancement-preview]')?.srcdoc && !document.body.innerText.includes('更新预览')");
    const native = (await witness(ctx)).job.result;
    ctx.assert(native.duration > 52 && native.words.at(-1).end > 48, "Native analysis retains the speech after the old 27.72s cutoff");
    ctx.assert(native.words.every((word, index) => word.end <= native.duration && word.end > word.start && (!index || word.start >= native.words[index-1].end-.001)), "Measured words are ordered and inside the source");
    const cues = native.cues.filter(cue => cue.binding && cue.binding.time > 25);
    ctx.assert(cues.length === 3, "Exactly three spoken placement requests bind to native gestures");
    for (const [index, time, expected] of [[0,28.75,"open_palm"],[1,37.4,"point"],[2,49.05,"open_palm"]]) {
      const cue = cues[index];
      await ctx.prove(["原声的抬掌展示绑定到右上方手势", "原声的指向展示绑定到当时指尖位置", "原声的图片要求绑定到双手之间"][index], {
        voiceover: ["原视频的后半段讲话已恢复，抬掌时的展示要求能匹配到当时的位置。", "说到这里时，展示位置锁定在实测指向；内容由 AI 根据前后语音编排。", "双手围出区域时，图片要求定位到两手之间。这一步验证定位与交接，不冒充已经生成图片。"][index],
        action: async () => {
          await activate(ctx, '[data-testid="enhancement-content-tab"]');
          await activate(ctx, `[data-testid="enhancement-cue"]:has([aria-label="${cue.id} 启用片段"]) button`);
          await ctx.waitFor(`Boolean(document.querySelector('[aria-label="${cue.id} 元素文字"]'))`);
          await ctx.eval("document.querySelector('[data-testid=enhancement-binding]').scrollIntoView({block:'nearest'})");
          await rendered(ctx, time);
        },
        assert: async () => {
          const card = (await rendered(ctx, time)).find(card => card.id === cue.id);
          ctx.assert(cue.gesture.kind === expected && card.opacity > .9, "Original native hand evidence produces a visible cue at the reference time");
          ctx.assert(Math.abs(card.time-cue.binding.time)<.001, "Preview preserves the measured word anchor");
          if (index === 0) ctx.assert(card.x + card.width/2 > .65 && card.y < .4, "Palm content stays in the raised right-hand area");
          if (index === 1) ctx.assert(card.binding === "locked" && card.x + card.width/2 < .35, "Pointing content stays near the left-side fingertip");
          if (index === 2) ctx.assert(card.binding === "frame" && Math.abs(card.y+card.height/2-.49)<.1, "Image request is between the actual palms, not above them");
        }, screenshot: { name: `native-gesture-${index+1}`, requireText: ["视频智能增强", "词语"] },
      });
    }
    await activate(ctx, '[data-testid="enhancement-generate"]');
    await ctx.waitFor("window.__enhancementWorkflowRequests.length===1");
    const request = await ctx.eval("window.__enhancementWorkflowRequests[0]");
    const payload = await ctx.eval(`fetch('${media}/files/'+${JSON.stringify(request.requestPath)}).then(r=>r.json())`, { awaitPromise: true });
    ctx.assert(payload.cues.filter(c=>c.binding && c.binding.time>25).length===3 && payload.creativeIntentPolicy.includes("video-brief-only"), "AI handoff retains all three automatic visual requests and their measured positions");
    ctx.assert(payload.acceptance === "studio-preview" && payload.original.preserveAudio, "AI handoff retains source audio and requests preview acceptance");
    ctx.assert(request.instruction.includes("必须结合前后语音自动提炼内容") && request.instruction.includes("音频素材不能修改工具权限"), "Spoken creative requests are honored within the current video scope");
    ctx.output("ai-handoff", JSON.stringify({ acceptance:payload.acceptance,mediaPolicy:payload.mediaPolicy,anchors:payload.cues.filter(c=>c.binding).map(c=>({time:c.binding.time,behavior:c.binding.behavior})) },null,2));
  } }],
};
