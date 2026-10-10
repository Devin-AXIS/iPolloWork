import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
const vo = await loadVoiceoverParagraphs("video-local-enhancement");
export default { id: "video-local-enhancement", title: "视频智能增强 · 全本地语音、手势与人物轮廓", kind: "user-facing", preserveTheme: true,
  cdpTarget: { urlIncludes: "127.0.0.1:5268/tests/video-enhancement-proof.html" },
  steps: [{ name: "上传、分析、编辑、应用、恢复与失败保护", async run(ctx) {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)");
    await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1180, height: 850, deviceScaleFactor: 1, mobile: false });
    if (await ctx.eval("Boolean(document.querySelector('[data-testid=video-enhancement-panel]'))")) {
      await ctx.trustedClick('[data-slot="dialog-close"]');
      await ctx.waitFor("!document.querySelector('[data-testid=video-enhancement-panel]')");
    }
    const setup = await ctx.eval("fetch('http://127.0.0.1:5288/setup').then(r=>r.json())", { awaitPromise: true });
    const upload = async file => {
      const doc = await ctx.client.send("DOM.getDocument");
      const node = await ctx.client.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: '[data-testid="enhancement-file"]' });
      await ctx.client.send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [file] });
      await ctx.waitFor("!document.querySelector('[data-testid=enhancement-start]').disabled");
      await ctx.trustedClick('[data-testid="enhancement-start"]');
    };
    await ctx.prove("真实上传后启动本地模型分析", { voiceover: vo[0], action: async () => {
      await ctx.trustedClick('[data-testid="video-enhancement-open"]');
      await ctx.waitForText("本地语音与人物模型已就绪");
      await ctx.waitForText("手势模型已就绪");
      await ctx.waitForText("人物分割模型已就绪");
      await upload(setup.source);
      await ctx.waitFor("Boolean(document.querySelector('[role=progressbar]'))", { timeoutMs: 30000 });
    }, assert: async () => { ctx.assert(await ctx.eval("document.body.innerText.includes('取消分析')"), "Analysis can be cancelled without a cloud model"); },
      screenshot: { name: "local-analysis", requireText: ["全部在本机处理", "取消分析"] } });
    await ctx.waitForText("本地分析完成", { timeoutMs: 300000 });
    await ctx.prove("真实人物轮廓和手势保护可见且元素放置安全", { voiceover: vo[1], action: async () => {
      await ctx.fill('[aria-label="enhance-2 元素文字"]', "第一，提高质量");
      await ctx.trustedClick('[data-testid="enhancement-cue"]:has([aria-label="enhance-2 元素文字"]) button');
      await ctx.waitFor("!document.querySelector('video').seeking && document.querySelector('video').readyState>=2 && Math.abs(document.querySelector('video').currentTime-Number(document.querySelector('[aria-label=\"enhance-2 开始秒数\"]').value))<.2");
      await ctx.trustedClick('[data-testid="enhancement-cue"] button');
      await ctx.waitFor("document.querySelector('video')?.videoWidth>0");
      if (!await ctx.eval("document.querySelector('[data-testid=enhancement-show-protection]').checked")) await ctx.trustedClick('[data-testid="enhancement-show-protection"]');
      await ctx.waitFor("document.querySelector('[data-testid=enhancement-protection] path')?.getAttribute('d').length>0");
    }, assert: async () => {
      const witness = await ctx.eval("fetch('http://127.0.0.1:5288/witness').then(r=>r.json())", { awaitPromise: true });
      ctx.assert(witness.job.result.segments.length > 0, "Real Whisper timestamps saved");
      ctx.assert(witness.job.result.people.some(frame => frame.boxes.length), "Real person detections saved");
      ctx.assert(witness.job.result.hands.some(frame => frame.boxes.length), "Real ONNX hand detections saved");
      ctx.assert(witness.job.result.gestures.length > 0, "Stable measured gesture events saved");
      ctx.assert(witness.job.result.masks.some(mask => mask.data), "Real PPHumanSeg contours saved");
      ctx.assert(witness.job.result.cues.some(cue => cue.enabled && cue.avoidance === "contour"), "Measured contours drive final safe positioning");
      ctx.assert(witness.job.result.timings.totalMs > 0, "Actual offline analysis duration recorded");
      ctx.assert(witness.job.result.cues.some(cue => cue.enabled && cue.gesture), "Speech and gestures matched on the server");
      ctx.assert(witness.job.result.cues.some(cue => cue.enabled && cue.rect), "At least one safe editable element exists");
      ctx.assert(witness.html.includes("增强前时间轴"), "Analysis has not overwritten the timeline");
      const safe = witness.job.result.cues.filter(cue => cue.enabled).every(cue => {
        if (cue.avoidance !== "contour") return witness.job.result.people.filter(frame => frame.time >= cue.start - .5 && frame.time <= cue.end + .5).every(frame => frame.boxes.every(box => cue.rect.x + cue.rect.width <= box.x || cue.rect.x >= box.x + box.width || cue.rect.y + cue.rect.height <= box.y || cue.rect.y >= box.y + box.height));
        return witness.job.result.masks.filter(frame => frame.time >= Math.max(0, cue.start - .25) && frame.time <= cue.end + .25).every(frame => frame.data && Array.from({ length: 4096 }, (_, cell) => cell).every(cell => {
          if (!(Number.parseInt(frame.data[Math.floor(cell / 4)], 16) >> (3 - cell % 4) & 1)) return true;
          const x = cell % 64 / 64, y = Math.floor(cell / 64) / 64;
          return cue.rect.x + cue.rect.width <= x || cue.rect.x >= x + 1 / 64 || cue.rect.y + cue.rect.height <= y || cue.rect.y >= y + 1 / 64;
        }));
      });
      ctx.assert(safe, "Suggestions avoid measured foreground in every sampled display frame");
      const handsSafe = witness.job.result.cues.filter(cue => cue.enabled).every(cue => witness.job.result.hands.filter(frame => frame.time >= cue.start - .25 && frame.time <= cue.end + .25).every(frame => frame.boxes.every(box => cue.rect.x + cue.rect.width <= box.x || cue.rect.x >= box.x + box.width || cue.rect.y + cue.rect.height <= box.y || cue.rect.y >= box.y + box.height)));
      ctx.assert(handsSafe, "Suggestions avoid measured hands throughout their windows");
      ctx.assert(await ctx.eval("(() => { const result=document.querySelector('[data-testid=enhancement-result]').getBoundingClientRect(); const actions=document.querySelector('[data-testid=enhancement-actions]').getBoundingClientRect(); return result.height>100 && result.bottom<=actions.top+1; })()"), "Preview and suggestions do not overlap the apply controls");
    }, screenshot: { name: "local-suggestions", requireText: ["元素建议", "应用到时间轴"] } });
    await ctx.prove("时间轴应用与备份恢复均真实落盘", { voiceover: vo[2], action: async () => {
      const measured = await ctx.eval("fetch('http://127.0.0.1:5288/witness').then(r=>r.json())", { awaitPromise: true });
      const linked = measured.job.result.cues.find(cue => cue.enabled && cue.gesture && !cue.reason?.includes("被占用"));
      ctx.assert(Boolean(linked), "Fixture contains a safe hand-directed cue");
      await ctx.trustedClick(`[aria-label="${linked.id} 元素位置"]`);
      await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
      await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
      await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await ctx.trustedClick('[data-testid="enhancement-apply"]');
      await ctx.waitForText("已应用到时间轴");
    }, assert: async () => {
      const applied = await ctx.eval("fetch('http://127.0.0.1:5288/witness').then(r=>r.json())", { awaitPromise: true });
      ctx.assert(applied.job.status === "applied" && applied.html.includes('data-track-index="1"'), "Editable clips saved");
      ctx.assert(applied.html.includes("第一，提高质量"), "User correction saved");
      ctx.assert(applied.job.result.cues.some(cue => cue.enabled && cue.placement === "gesture" && cue.gesture), "User positioning choice saved and recomputed");
      ctx.assert(!/https?:\/\//.test(applied.html), "Composition has no remote asset dependencies");
      await ctx.clickText("恢复增强前时间轴", { selector: "button" });
      await ctx.waitForText("已恢复增强前的时间轴");
      const restored = await ctx.eval("fetch('http://127.0.0.1:5288/witness').then(r=>r.json())", { awaitPromise: true });
      ctx.assert(restored.html.includes("增强前时间轴") && restored.job.status === "ready", "Original timeline restored");
    }, screenshot: { name: "timeline-restored", requireText: ["已恢复增强前的时间轴", "应用到时间轴"] } });
    const restored = await ctx.eval("fetch('http://127.0.0.1:5288/witness').then(r=>r.json())", { awaitPromise: true });
    await ctx.prove("无音轨上传明确报错且不误用旧视频建议", { voiceover: vo[3], action: async () => {
      await upload(setup.noAudio);
      await ctx.waitForText("视频没有音轨");
    }, assert: async () => {
      const failed = await ctx.eval("fetch('http://127.0.0.1:5288/witness').then(r=>r.json())", { awaitPromise: true });
      ctx.assert(failed.html === restored.html && failed.job.id === restored.job.id, "Invalid input creates no job and does not change the timeline");
      ctx.assert(await ctx.eval("!document.querySelector('[data-testid=enhancement-apply]')"), "Previous video's apply button is removed after failed analysis");
    }, screenshot: { name: "missing-audio", requireText: ["视频没有音轨"] } });
    await ctx.prove("取消本地分析释放任务并保留时间轴", { voiceover: vo[4], action: async () => {
      await upload(setup.source);
      await ctx.waitForText("取消分析");
      await ctx.clickText("取消分析", { selector: "button" });
      await ctx.waitForText("分析已取消或超时");
    }, assert: async () => {
      const cancelled = await ctx.eval("fetch('http://127.0.0.1:5288/witness').then(r=>r.json())", { awaitPromise: true });
      ctx.assert(cancelled.job.status === "cancelled" && cancelled.html === restored.html, "Cancellation persisted and original timeline remained exact");
    }, screenshot: { name: "analysis-cancelled", requireText: ["分析已取消", "当前时间轴未更改"] } });
  } }] };
