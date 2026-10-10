import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
const vo = await loadVoiceoverParagraphs("video-local-enhancement");
export default { id: "video-local-enhancement", title: "视频智能增强 · 全本地第一步", kind: "user-facing", preserveTheme: true,
  cdpTarget: { urlIncludes: "127.0.0.1:5268/tests/video-enhancement-proof.html" },
  steps: [{ name: "上传、离线分析、编辑、应用与恢复", async run(ctx) {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)");
    await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1180, height: 850, deviceScaleFactor: 1, mobile: false });
    await ctx.prove("真实上传后启动本地模型分析", { voiceover: vo[0], action: async () => {
      await ctx.trustedClick('[data-testid="video-enhancement-open"]');
      await ctx.waitForText("本地语音与人物模型已就绪");
      const setup = await ctx.eval("fetch('http://127.0.0.1:5288/setup').then(r=>r.json())", { awaitPromise: true });
      const doc = await ctx.client.send("DOM.getDocument");
      const node = await ctx.client.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: '[data-testid="enhancement-file"]' });
      await ctx.client.send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [setup.source] });
      await ctx.trustedClick('[data-testid="enhancement-start"]');
      await ctx.waitFor("Boolean(document.querySelector('[role=progressbar]'))", { timeoutMs: 30000 });
    }, assert: async () => { ctx.assert(await ctx.eval("document.body.innerText.includes('取消分析')"), "Analysis can be cancelled without a cloud model"); },
      screenshot: { name: "local-analysis", requireText: ["全部在本机处理", "取消分析"] } });
    await ctx.waitForText("本地分析完成", { timeoutMs: 300000 });
    await ctx.prove("真实语音结果生成元素且避开检测到的人物", { voiceover: vo[1], action: async () => {
      await ctx.fill('[aria-label="enhance-2 元素文字"]', "第一，提高质量");
      await ctx.trustedClick('[data-testid="enhancement-cue"] button');
      await ctx.waitFor("document.querySelector('video')?.videoWidth>0");
    }, assert: async () => {
      const witness = await ctx.eval("fetch('http://127.0.0.1:5288/witness').then(r=>r.json())", { awaitPromise: true });
      ctx.assert(witness.job.result.segments.length > 0, "Real Whisper timestamps saved");
      ctx.assert(witness.job.result.people.some(frame => frame.boxes.length), "Real person detections saved");
      ctx.assert(witness.job.result.cues.some(cue => cue.enabled && cue.rect), "At least one safe editable element exists");
      ctx.assert(witness.html.includes("增强前时间轴"), "Analysis has not overwritten the timeline");
      const safe = witness.job.result.cues.filter(cue => cue.enabled).every(cue => witness.job.result.people.filter(frame => frame.time >= cue.start - .5 && frame.time <= cue.end + .5).every(frame => frame.boxes.every(box => cue.rect.x + cue.rect.width <= box.x || cue.rect.x >= box.x + box.width || cue.rect.y + cue.rect.height <= box.y || cue.rect.y >= box.y + box.height)));
      ctx.assert(safe, "Applied suggestions avoid detected people throughout their windows");
    }, screenshot: { name: "local-suggestions", requireText: ["元素建议", "应用到时间轴"] } });
    await ctx.prove("时间轴应用与备份恢复均真实落盘", { voiceover: vo[2], action: async () => {
      await ctx.trustedClick('[data-testid="enhancement-apply"]');
      await ctx.waitForText("已应用到时间轴");
    }, assert: async () => {
      const applied = await ctx.eval("fetch('http://127.0.0.1:5288/witness').then(r=>r.json())", { awaitPromise: true });
      ctx.assert(applied.job.status === "applied" && applied.html.includes('data-track-index="1"'), "Editable clips saved");
      ctx.assert(applied.html.includes("第一，提高质量"), "User correction saved");
      ctx.assert(!/https?:\/\//.test(applied.html), "Composition has no remote asset dependencies");
      await ctx.clickText("恢复增强前时间轴", { selector: "button" });
      await ctx.waitForText("已恢复增强前的时间轴");
      const restored = await ctx.eval("fetch('http://127.0.0.1:5288/witness').then(r=>r.json())", { awaitPromise: true });
      ctx.assert(restored.html.includes("增强前时间轴") && restored.job.status === "ready", "Original timeline restored");
    }, screenshot: { name: "timeline-restored", requireText: ["已恢复增强前的时间轴", "应用到时间轴"] } });
  } }] };
