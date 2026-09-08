import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-console");
const studio = `document.querySelector('iframe[title="视频控制台"]')?.contentDocument`;
const element = selector => `${studio}?.querySelector(${JSON.stringify(selector)})`;

async function selectOption(ctx, label, value) {
  if (await ctx.eval(`document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})?.textContent.includes(${JSON.stringify(value)})`)) return;
  await ctx.client.send("Page.bringToFront");
  await ctx.trustedClick(`[aria-label="${label}"]`);
  await ctx.waitFor(`(() => {
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(node => node.textContent.trim() === ${JSON.stringify(value)} && node.getBoundingClientRect().width > 0);
    if (!option) return false;
    option.focus(); return true;
  })()`);
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await ctx.waitFor(`!document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})?.disabled && document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})?.textContent.includes(${JSON.stringify(value)})`);
}

async function openConsole(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30000 });
  await ctx.waitFor(`Boolean(document.querySelector('[data-session-surface-id="' + location.hash.split('/').pop() + '"]'))`);
  await ctx.eval(`document.querySelector('button[aria-label="Select tab: 视频控制台"]')?.click()`);
  if(await ctx.eval(`Boolean(document.querySelector('button[aria-label="Select tab: 视频控制台"]'))`))await ctx.waitFor(`Boolean(${studio})`);
  if (!await ctx.eval(`Boolean(${studio})`)) {
    await ctx.eval(`document.querySelector('button[aria-label="打开右侧面板"]')?.click()`);
    if (await ctx.eval(`Boolean(document.querySelector('button[aria-label="添加侧面板入口"]'))`)) {
      await ctx.eval(`document.querySelector('button[aria-label="添加侧面板入口"]').click()`);
    }
    await ctx.clickText("视频控制台", { selector: '[role="menuitem"],button' });
  }
  await ctx.waitFor(`Boolean(${element("#generateMode")})`);
  if (!await ctx.eval(`Boolean(document.querySelector('textarea[name="prompt"]'))`)) {
    await ctx.eval(`${element("#settings")}.click()`);
  }
  await ctx.waitFor(`document.querySelector('[data-testid="workspace-app-inspector"]')?.innerText.includes('视频参数')`,{timeoutMs:30000});
}

async function api(ctx, suffix) {
  return ctx.eval(`(async()=>{
    const server=await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
    const response=await fetch(server.baseUrl+${JSON.stringify(suffix)},{headers:{authorization:'Bearer '+(server.ownerToken||server.clientToken),'X-iPolloWork-Host-Token':server.hostToken}});
    if(!response.ok)throw new Error('Witness HTTP '+response.status);
    return response.json();
  })()`, { awaitPromise: true });
}

export default {
  id: "video-console",
  title: "Generate video, switch sessions, reopen and retain the output",
  kind: "user-facing", preserveTheme: true,
  // Deliberately requires explicit opt-in: this journey submits one potentially billable task.
  requiredEnv: ["IPOLLOWORK_EVAL_WORKSPACE_ID", "IPOLLOWORK_EVAL_SESSION_ID", "IPOLLOWORK_EVAL_OTHER_SESSION_ID", "IPOLLOWORK_EVAL_VIDEO_LIVE"],
  steps: [{
    name: "Model-aware video console and persistent output journey",
    async run(ctx) {
      ctx.assert(ctx.env.IPOLLOWORK_EVAL_VIDEO_LIVE === "1", "Live generation must be explicitly enabled");
      const workspaceId=ctx.env.IPOLLOWORK_EVAL_WORKSPACE_ID, sessionId=ctx.env.IPOLLOWORK_EVAL_SESSION_ID;
      const route=`/workspace/${workspaceId}/session/${sessionId}`;
      const messagePath=`/workspace/${workspaceId}/sessions/${sessionId}/messages`;
      await ctx.navigateHash(route);
      const beforeMessages=JSON.stringify(await api(ctx,messagePath));
      let jobId = ctx.env.IPOLLOWORK_EVAL_VIDEO_JOB_ID, outputPath;
      await ctx.prove("The console opens with a bound model and no unavailable choices", {
        voiceover:vo[0], action:()=>openConsole(ctx),
        assert:async()=>{
          await ctx.waitFor(`Boolean(document.querySelector('textarea[name="prompt"]'))`);
          if (ctx.env.IPOLLOWORK_EVAL_VIDEO_MODEL) {
            await selectOption(ctx, "视频模型", ctx.env.IPOLLOWORK_EVAL_VIDEO_MODEL);
          }
          ctx.assert(await ctx.eval(`!document.querySelector('[data-testid="workspace-app-inspector"]').innerText.includes('未连接')`),"Unbound models are not shown as choices");
        }, screenshot:{name:"bound-video-model",requireText:["视频参数"]},
      });
      await ctx.prove("The selected model exposes actual first-frame inputs and only supported controls", {
        voiceover:vo[1],action:async()=>{
          await ctx.eval(`${element("#generateMode")}.click()`);
          await selectOption(ctx,"生成方式","首帧生视频");
        },
        assert:async()=>{
          await ctx.waitFor(`Boolean(document.querySelector('textarea[name="firstFrame"]'))`);
          ctx.assert(await ctx.eval(`document.querySelector('[aria-label="画幅"]')?.innerText.includes('跟随输入')`),"Image-to-video must follow the source image ratio");
          if(ctx.env.IPOLLOWORK_EVAL_VIDEO_MODEL?.includes('H3')){
            ctx.assert(await ctx.eval(`${element("#editMode")}.disabled`),"Unverified H3 video editing is unavailable");
            ctx.assert(await ctx.eval(`!document.querySelector('[aria-label="AI 生成水印"]') && document.querySelector('[aria-label="分辨率"]')?.innerText.includes('0.5MP')`),"Workflow controls use the actual pixel budget and no unsupported watermark switch");
          }
        },screenshot:{name:"video-image-parameters",requireText:["视频参数","首帧图片"]},
      });
      await ctx.prove("A submitted task survives switching to another session and back", {
        voiceover:vo[2],action:async()=>{
          await ctx.eval(`${element("#generateMode")}.click()`);
          await ctx.waitFor(`Boolean(document.querySelector('textarea[name="prompt"]'))`);
          if (!jobId) {
          if(ctx.env.IPOLLOWORK_EVAL_VIDEO_FIRST_FRAME){
            await selectOption(ctx,"生成方式","首帧生视频");
            await ctx.fill('textarea[name="firstFrame"]',ctx.env.IPOLLOWORK_EVAL_VIDEO_FIRST_FRAME);
          } else await selectOption(ctx,"生成方式","文生视频");
          await ctx.fill('textarea[name="prompt"]',ctx.env.IPOLLOWORK_EVAL_VIDEO_FIRST_FRAME?"保持首帧中的人物、构图和插画风格。固定镜头，天空的云缓慢飘动，人物衣角轻轻摆动，连续自然运动，不要文字。":"海边的灯塔，平静的海浪，固定镜头，5 秒，不要人物或文字。");
          await selectOption(ctx, "时长（秒）", "5");
          const previous=await ctx.eval(`Array.from(${studio}.querySelectorAll('[data-job-id]')).map(node=>node.dataset.jobId)`);
          await ctx.clickText("生成视频",{selector:"button"});
          await ctx.waitFor(`Array.from(${studio}.querySelectorAll('[data-job-id]')).some(node=>!${JSON.stringify(previous)}.includes(node.dataset.jobId))`,{timeoutMs:180000});
          jobId=await ctx.eval(`Array.from(${studio}.querySelectorAll('[data-job-id]')).find(node=>!${JSON.stringify(previous)}.includes(node.dataset.jobId)).dataset.jobId`);
          }
          ctx.output("Video job (reuse this ID after an interrupted proof; do not submit twice)", jobId);
          await ctx.navigateHash(`/workspace/${workspaceId}/session/${ctx.env.IPOLLOWORK_EVAL_OTHER_SESSION_ID}`);
          await ctx.waitFor(`Boolean(document.querySelector('[data-session-surface-id="${ctx.env.IPOLLOWORK_EVAL_OTHER_SESSION_ID}"]'))`);
          await ctx.navigateHash(route);await openConsole(ctx);
        },assert:async()=>{
          await ctx.waitFor(`Boolean(${element(`[data-job-id="${jobId}"]`)})`);
          const status = await ctx.eval(`${element(`[data-job-id="${jobId}"]`)}.innerText`);
          ctx.assert(!/生成失败|待确认|保存失败/.test(status), `The task must be accepted by the provider: ${status}`);
          await ctx.eval(`${element(`[data-job-id="${jobId}"]`)}.scrollIntoView({block:'center'})`);
        },screenshot:{name:"video-task-restored",requireText:["视频控制台"]},
      });
      await ctx.prove("The resulting video plays and persists as this session's artifact without a chat message", {
        voiceover:vo[3],action:async()=>{
          await ctx.waitFor(`/已保存|生成失败|待确认|保存失败/.test(${element(`[data-job-id="${jobId}"]`)}?.innerText || '')`,{timeoutMs:1200000});
          const status = await ctx.eval(`${element(`[data-job-id="${jobId}"]`)}.innerText`);
          ctx.assert(status.includes('已保存'), `The provider must complete and save the task: ${status}`);
          const page=await api(ctx,`/workspace/${workspaceId}/artifacts?sessionId=${sessionId}`);
          outputPath=page.items.find(item=>item.path.endsWith(`${jobId}.mp4`))?.path;
          ctx.assert(Boolean(outputPath),"The generated file is registered to the initiating session");
          const epoch=await ctx.eval("performance.timeOrigin");await ctx.client.send("Page.reload");
          await ctx.waitFor(`performance.timeOrigin!==${epoch}&&Boolean(window.__ipolloworkControl)`);await openConsole(ctx);
        },assert:async()=>{
          await ctx.waitFor(`${element("#player")}?.readyState>=2`,{timeoutMs:60000});
          ctx.assert(await ctx.eval(`${element("#player")}.videoWidth>0`),"Saved video decodes after reload");
          await ctx.eval(`(async()=>{const player=${element("#player")};player.muted=true;player.currentTime=0;await player.play();})()`,{awaitPromise:true});
          await ctx.waitFor(`${element("#player")}.currentTime>0.5 && !${element("#player")}.paused`,{timeoutMs:15000});
          await ctx.eval(`${element("#player")}.pause()`);
          ctx.assert(JSON.stringify(await api(ctx,messagePath))===beforeMessages,"The console did not insert chat messages");
          const page=await api(ctx,`/workspace/${workspaceId}/artifacts?sessionId=${sessionId}`);
          ctx.assert(page.items.some(item=>item.path===outputPath),"The artifact remains after reload");
          await ctx.eval(`${element("#player")}.scrollIntoView({block:'center'})`);
        },screenshot:{name:"video-output-retained",requireText:["视频控制台"]},
      });
    },
  }],
};
