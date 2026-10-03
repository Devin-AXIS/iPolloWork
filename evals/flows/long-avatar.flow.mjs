const proofOrigin = process.env.IPOLLOWORK_AVATAR_PROOF_ORIGIN || "http://127.0.0.1:5173";

export default {
  id: "long-avatar", title: "Avatar generation dialog and compact history", kind: "user-facing",
  cdpTarget: { urlIncludes: "localhost:5173" }, preserveTheme: true,
  steps: [{ name: "Review and control a long avatar task", run: async ctx => {
    await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 980, height: 950, deviceScaleFactor: 1, mobile: false });
    await ctx.client.send("Page.navigate", { url: `${proofOrigin}/tests/video-avatar-proof.html?panel=avatar&long&segments=79` });
    await ctx.waitFor("Boolean(document.querySelector('[data-testid=avatar-job-card]'))");
    await ctx.prove("Long history stays compact in the inspector", {
      voiceover: "七十九段的任务只占一行，状态和段数仍然可见。",
      action: async () => {},
      assert: async () => {
        const state = await ctx.eval("(() => {const card=document.querySelector('[data-testid=avatar-job-card]');return {height:card.getBoundingClientRect().height,text:card.innerText,dialog:!!document.querySelector('[data-testid=avatar-task-dialog]')};})()");
        ctx.assert(state.height < 90 && state.text.includes("1/79") && !state.dialog, JSON.stringify(state));
      },
      screenshot: { name: "avatar-compact-history", requireText: ["生成记录", "1/79 段"] },
    });
    await ctx.prove("Task dialog reveals progress and bounded segment details", {
      voiceover: "点击记录打开进度弹窗，明细只在需要时展开。",
      action: async () => { await ctx.trustedClick('[data-testid=avatar-job-card]'); await ctx.waitFor("Boolean(document.querySelector('[data-testid=avatar-task-dialog]'))"); await ctx.trustedClick('[data-testid=avatar-task-dialog] [data-slot=collapsible-trigger]'); },
      assert: async () => {
        const state = await ctx.eval("(() => {const dialog=document.querySelector('[data-testid=avatar-task-dialog]');const list=dialog.querySelector('[data-testid=avatar-job-details]');return {text:dialog.innerText,height:list.getBoundingClientRect().height,scrollHeight:list.scrollHeight,rows:list.children.length};})()");
        ctx.assert(state.text.includes("已完成 1/79 段") && state.height <= 200 && state.scrollHeight > state.height && state.rows === 79, JSON.stringify(state));
      },
      screenshot: { name: "avatar-task-details", requireText: ["数字人片段", "已完成 1/79 段", "片段详情"] },
    });
    await ctx.prove("Failed segment retry keeps saved work", {
      voiceover: "只重试失败的第二段，第一段保持不变。",
      action: async () => { await ctx.clickText("重试", { selector: "[data-testid=avatar-job-details] button" }); await ctx.waitForText("生成中"); },
      assert: async () => {
        const state = await ctx.eval("(() => {const job=window.avatarProof.jobs[0];return {index:window.avatarProof.requests.find(item=>item.action==='retry-segment')?.args.index,first:job.avatarSequence.segments[0].path};})()");
        ctx.assert(state.index === 1 && state.first === "saved-first.mp4", JSON.stringify(state));
      },
      screenshot: { name: "avatar-retry", requireText: ["生成中", "1/79"] },
    });
    await ctx.prove("Pause waits for a segment boundary and resume continues", {
      voiceover: "暂停保存当前片段；继续生成时已完成的段落不会重新提交。",
      action: async () => { await ctx.clickText("当前片段完成后暂停", { selector: "[data-testid=avatar-task-dialog] button" }); await ctx.waitForText("暂停请求已收到"); await ctx.eval("window.avatarProof.finishCurrent()"); await ctx.waitForText("继续生成"); await ctx.clickText("继续生成", { selector: "[data-testid=avatar-task-dialog] button" }); },
      assert: async () => {
        const state = await ctx.eval("(() => {const job=window.avatarProof.jobs[0];return {status:job.status,second:job.avatarSequence.segments[1].status,actions:window.avatarProof.requests.filter(item=>item.action==='pause'||item.action==='resume').map(item=>item.action)};})()");
        ctx.assert(state.status === "running" && state.second === "succeeded" && state.actions.join(",") === "pause,resume", JSON.stringify(state));
      },
      screenshot: { name: "avatar-resumed", requireText: ["生成中", "2/79"] },
    });
    await ctx.prove("Stop remains a separate confirmed action", {
      voiceover: "停止是终止操作，需要确认，之前保存的结果仍在。",
      action: async () => { await ctx.clickText("停止生成", { selector: "[data-testid=avatar-task-dialog] button" }); await ctx.waitForText("停止数字人生成？"); await ctx.trustedClick('[data-slot=alert-dialog-action]'); await ctx.waitForText("已停止后续生成"); },
      assert: async () => {
        const state = await ctx.eval("(() => {const job=window.avatarProof.jobs[0];return {status:job.status,first:job.avatarSequence.segments[0].path,request:window.avatarProof.requests.some(item=>item.action==='stop')};})()");
        ctx.assert(state.status === "stopped" && state.first === "saved-first.mp4" && state.request, JSON.stringify(state));
      },
      screenshot: { name: "avatar-stopped", requireText: ["已停止", "已停止后续生成"] },
    });
  } }, { name: "Use a completed avatar", run: async ctx => {
    await ctx.client.send("Page.navigate", { url: `${proofOrigin}/tests/video-avatar-proof.html?panel=avatar&long&complete` });
    await ctx.waitFor("Boolean(document.querySelector('[data-testid=avatar-job-card]'))");
    await ctx.prove("Completion offers preview, asset view and insertion", {
      voiceover: "完成后显示预览入口，以及查看素材和插入当前视频两个明确操作。",
      action: async () => { await ctx.trustedClick('[data-testid=avatar-job-card]'); await ctx.waitForText("插入当前视频"); },
      assert: async () => {
        const text = await ctx.eval("document.querySelector('[data-testid=avatar-task-dialog]').innerText");
        ctx.assert(["100%", "预览数字人", "在素材中查看", "插入当前视频"].every(item => text.includes(item)), text);
      },
      screenshot: { name: "avatar-complete-actions", requireText: ["100%", "预览数字人", "插入当前视频"] },
    });
    await ctx.prove("Both asset actions target the generated file", {
      voiceover: "素材操作使用这次生成的片段路径。",
      action: async () => { await ctx.clickText("在素材中查看", { selector: "[data-testid=avatar-task-dialog] button" }); await ctx.waitFor("!document.querySelector('[data-testid=avatar-task-dialog]')"); await ctx.trustedClick('[data-testid=avatar-job-card]'); await ctx.clickText("插入当前视频", { selector: "[data-testid=avatar-task-dialog] button" }); },
      assert: async () => {
        const state = await ctx.eval("window.avatarProof.requests.filter(item=>item.action==='asset-view'||item.action==='asset-insert').map(item=>({action:item.action,path:item.path,start:item.start}))");
        ctx.assert(state.length === 2 && state[0].path === "video/avatar-proof/assets/avatar-result.mp4" && state[1].path === state[0].path && state[1].start === 0, JSON.stringify(state));
      },
      screenshot: { name: "avatar-asset-routed", requireText: ["已按配音起点 0.0 秒插入时间线"] },
    });
  } }, { name: "Estimate remaining time from completed segments", run: async ctx => {
    await ctx.client.send("Page.navigate", { url: `${proofOrigin}/tests/video-avatar-proof.html?panel=avatar&long&eta` });
    await ctx.waitFor("Boolean(document.querySelector('[data-testid=avatar-job-card]'))");
    await ctx.prove("ETA appears only after measured segments", {
      voiceover: "已有三个片段完成后，弹窗根据真实耗时给出剩余时间区间。",
      action: async () => { await ctx.trustedClick('[data-testid=avatar-job-card]'); await ctx.waitForText("预计还需约"); },
      assert: async () => {
        const text = await ctx.eval("document.querySelector('[data-testid=avatar-task-dialog]').innerText");
        ctx.assert(text.includes("已完成 3/5 段") && text.includes("预计还需约") && text.includes("60%"), text);
      },
      screenshot: { name: "avatar-eta", requireText: ["已完成 3/5 段", "预计还需约", "60%"] },
    });
  } }],
};
