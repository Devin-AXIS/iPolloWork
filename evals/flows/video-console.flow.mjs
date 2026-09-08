import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-console");
const studio = `document.querySelector('iframe[title="视频控制台"]')?.contentDocument`;
const element = selector => `${studio}?.querySelector(${JSON.stringify(selector)})`;

async function selectOption(ctx, label, value) {
  if (await ctx.eval(`document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})?.textContent.includes(${JSON.stringify(value)})`)) return;
  await ctx.client.send("Page.bringToFront");
  await ctx.eval(`document.querySelectorAll('[data-video-proof-option]').forEach(node => node.removeAttribute('data-video-proof-option'))`);
  await ctx.trustedClick(`[aria-label="${label}"]`);
  await ctx.waitFor(`(() => {
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(node => node.textContent.trim() === ${JSON.stringify(value)} && node.getBoundingClientRect().width > 0);
    if (!option) return false;
    option.setAttribute('data-video-proof-option', 'true'); return true;
  })()`);
  await ctx.trustedClick('[data-video-proof-option="true"]');
  await ctx.waitFor(`!document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})?.disabled && document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})?.textContent.includes(${JSON.stringify(value)})`);
}

async function openConsole(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30000 });
  if (!await ctx.eval(`Boolean(${studio})`)) {
    if (await ctx.eval(`Boolean(document.querySelector('button[aria-label="打开右侧面板"]'))`)) {
      await ctx.trustedClick('button[aria-label="打开右侧面板"]');
    }
    if (await ctx.eval(`Boolean(document.querySelector('button[aria-label="添加侧面板入口"]'))`)) {
      await ctx.trustedClick('button[aria-label="添加侧面板入口"]');
    }
    await ctx.clickText("视频控制台", { selector: '[role="menuitem"],button' });
  }
  await ctx.waitFor(`Boolean(${element("#generateMode")})`);
  if (!await ctx.eval(`Boolean(document.querySelector('textarea[name="prompt"]'))`)) {
    await ctx.eval(`${element("#settings")}.click()`);
  }
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
      await ctx.prove("Editing switches to a supported operation and model-specific controls", {
        voiceover:vo[1],action:()=>ctx.eval(`${element("#editMode")}.click()`),
        assert:async()=>{
          await ctx.waitFor(`document.querySelector('[data-testid="workspace-app-inspector"]')?.innerText.includes('原视频')`);
          ctx.assert(await ctx.eval(`${element("#editMode")}.getAttribute('aria-pressed')==='true'`),"Edit mode is visibly selected");
        },screenshot:{name:"video-edit-parameters",requireText:["视频参数","原视频"]},
      });
      await ctx.prove("A submitted task survives switching to another session and back", {
        voiceover:vo[2],action:async()=>{
          await ctx.eval(`${element("#generateMode")}.click()`);
          await ctx.waitFor(`Boolean(document.querySelector('textarea[name="prompt"]'))`);
          if (!jobId) {
          await ctx.fill('textarea[name="prompt"]',"海边的灯塔，平静的海浪，固定镜头，5 秒，不要人物或文字。");
          await selectOption(ctx, "时长（秒）", "5");
          const previous=await ctx.eval(`Array.from(${studio}.querySelectorAll('[data-job-id]')).map(node=>node.dataset.jobId)`);
          await ctx.clickText("生成视频",{selector:"button"});
          await ctx.waitFor(`Array.from(${studio}.querySelectorAll('[data-job-id]')).some(node=>!${JSON.stringify(previous)}.includes(node.dataset.jobId))`,{timeoutMs:180000});
          jobId=await ctx.eval(`Array.from(${studio}.querySelectorAll('[data-job-id]')).find(node=>!${JSON.stringify(previous)}.includes(node.dataset.jobId)).dataset.jobId`);
          }
          ctx.output("Video job (reuse this ID after an interrupted proof; do not submit twice)", jobId);
          await ctx.navigateHash(`/workspace/${workspaceId}/session/${ctx.env.IPOLLOWORK_EVAL_OTHER_SESSION_ID}`);
          await ctx.navigateHash(route);await openConsole(ctx);
        },assert:async()=>{
          await ctx.waitFor(`Boolean(${element(`[data-job-id="${jobId}"]`)})`);
          ctx.assert(await ctx.eval(`!${element(`[data-job-id="${jobId}"]`)}.innerText.includes('生成失败')`),"The initiating session still owns the submitted task");
        },screenshot:{name:"video-task-restored",requireText:["本会话任务"]},
      });
      await ctx.prove("The resulting video plays and persists as this session's artifact without a chat message", {
        voiceover:vo[3],action:async()=>{
          await ctx.waitFor(`${element(`[data-job-id="${jobId}"]`)}?.innerText.includes('已保存')`,{timeoutMs:600000});
          const page=await api(ctx,`/workspace/${workspaceId}/artifacts?sessionId=${sessionId}`);
          outputPath=page.items.find(item=>item.path.endsWith(`${jobId}.mp4`))?.path;
          ctx.assert(Boolean(outputPath),"The generated file is registered to the initiating session");
          const epoch=await ctx.eval("performance.timeOrigin");await ctx.client.send("Page.reload");
          await ctx.waitFor(`performance.timeOrigin!==${epoch}&&Boolean(window.__ipolloworkControl)`);await openConsole(ctx);
        },assert:async()=>{
          await ctx.waitFor(`${element("#player")}?.readyState>=2`,{timeoutMs:60000});
          ctx.assert(await ctx.eval(`${element("#player")}.videoWidth>0`),"Saved video decodes after reload");
          ctx.assert(JSON.stringify(await api(ctx,messagePath))===beforeMessages,"The console did not insert chat messages");
          const page=await api(ctx,`/workspace/${workspaceId}/artifacts?sessionId=${sessionId}`);
          ctx.assert(page.items.some(item=>item.path===outputPath),"The artifact remains after reload");
        },screenshot:{name:"video-output-retained",requireText:["本会话任务"]},
      });
    },
  }],
};
