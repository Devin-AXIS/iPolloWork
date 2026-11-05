import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-work-template");
let wid;
const state = { sid: null, entry: null };
const storyboardRequest = "请先只做一个6秒、16:9的极简工作助手宣传片分镜，内容是想法变成下一步行动。只用原创可编辑图形，不需要外部图片或视频，不要旁白、字幕、音乐和音效；先保存分镜供我查看，不开始制作。";
const productionRequest = "按刚才保存的分镜完成这个6秒可编辑视频。保留原来确定的无旁白、无字幕、无音乐音效，使用原创可编辑图形表达想法变成下一步行动。完成画面与动效，保存实际视频源文件供内置播放检查，不需要MP4导出或发布。";

async function request(ctx, path, method = "GET", body) {
  const result = await ctx.eval(`(async()=>{
    const d=await import('/src/app/lib/desktop.ts'),i=await d.ipolloworkServerInfo();
    const r=await fetch(i.baseUrl+${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{Authorization:'Bearer '+(i.ownerToken||i.clientToken),'x-ipollowork-host-token':i.hostToken,'content-type':'application/json'},${body === undefined ? "" : `body:JSON.stringify(${JSON.stringify(body)}),`}signal:AbortSignal.timeout(15000)});
    return {ok:r.ok,status:r.status,data:await r.json()};
  })()`, { awaitPromise: true });
  ctx.assert(result.ok, `${method} ${path}: ${JSON.stringify(result.data).slice(0, 500)}`);
  return result.data;
}
const sessionPath = (suffix) => `/workspace/${wid}/sessions/${state.sid}${suffix}`;

async function click(ctx, selector) {
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, { label: selector });
  await ctx.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});e.click();return true;})()`);
}

async function openConversation(ctx) {
  await click(ctx, "[data-testid=session-header-work-conversation]");
  await ctx.waitFor(`Boolean(document.querySelector('[data-session-surface-id="${state.sid}"]'))`, { label: "test conversation surface", timeoutMs: 30000 });
}

async function send(ctx, text) {
  await openConversation(ctx);
  await ctx.waitFor("Boolean(document.querySelector('[contenteditable=true][data-lexical-editor=true]'))", { label: "composer" });
  await ctx.eval(`(()=>{const e=document.querySelector('[contenteditable=true][data-lexical-editor=true]');e.focus();const d=new DataTransfer();d.setData('text/plain',${JSON.stringify(text)});e.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));return true;})()`);
  await ctx.waitFor(`document.querySelector('[contenteditable=true][data-lexical-editor=true]')?.innerText.includes(${JSON.stringify(text.slice(0, 12))})`, { label: "pasted task" });
  for (const type of ["keyDown", "keyUp"]) await ctx.client.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await ctx.waitFor(`document.querySelector('[data-session-surface-id="${state.sid}"]')?.innerText.includes(${JSON.stringify(text.slice(0, 18))})`, { label: "submitted task" });
}

function delegated(snapshot) {
  return snapshot.messages.flatMap((message) => message.parts ?? []).filter((part) => part.type === "tool" && part.tool === "task").map((part) => ({
    role: `${part.state.input?.description ?? ""}\n${part.state.input?.prompt ?? ""}`.match(/\[project-agent:([^\]]+)\]/)?.[1],
    sid: part.state.metadata?.sessionId ?? String(part.state.output ?? "").match(/<task\s+id=["']([^"']+)/)?.[1],
    status: part.state.status,
  }));
}

async function waitForRoles(ctx, roles) {
  const deadline = Date.now() + 20 * 60_000;
  let last;
  while (Date.now() < deadline) {
    const snapshot = (await request(ctx, sessionPath("/snapshot"))).item;
    const work = (await request(ctx, sessionPath("/workflow"))).item;
    last = { status: snapshot.status, work: work.status, delegations: delegated(snapshot) };
    if (snapshot.status.type === "idle" && work.status === "review" && roles.every((role) => last.delegations.some((d) => d.role === role && d.status === "completed"))) return { snapshot, work, delegations: last.delegations };
    if (snapshot.status.type === "idle" && snapshot.messages.some((message) => message.info.role === "assistant" && message.info.error)) throw Error(`Native run failed: ${JSON.stringify(last)}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw Error(`Missing real role results: ${JSON.stringify(last)}`);
}

export default {
  id: "video-work-template",
  title: "Video work template delegates the existing production phases",
  kind: "user-facing",
  steps: [
    { name: "Video template exposes real prompts and installed Skills", run: async (ctx) => {
      await ctx.prove("A video conversation has four configured production roles", {
        voiceover: vo[0],
        action: async () => {
          wid = await ctx.eval("localStorage.getItem('ipollowork.react.activeWorkspace')");
          ctx.assert(wid, "An active local workspace is required");
          const created = await request(ctx, `/workspace/${wid}/sessions`, "POST", { title: `视频模板实测 ${Date.now().toString(36)}`, engineId: "opencode", model: { providerID: "openai", modelID: "gpt-6.1-sol" } });
          state.sid = created.item.id;
          ctx.log(`Native test session: ${state.sid}`);
          await ctx.navigateHash(`/workspace/${wid}/session/${state.sid}`);
          await ctx.eval("location.reload()");
          await ctx.waitFor("Boolean(window.__ipolloworkControl)", { label: "fixture registry after reload", timeoutMs: 60000 });
          await ctx.waitFor("Boolean(document.querySelector('[data-testid=session-header-project-overview]'))", { label: "test route", timeoutMs: 30000 });
          await openConversation(ctx);
          await click(ctx, "[data-testid=session-header-project-overview]");
          await click(ctx, "[data-testid=work-template-picker]");
          await ctx.waitFor("[...document.querySelectorAll('[role=option]')].some(e=>['视频制作','Video'].includes(e.innerText.trim()))", { label: "video method option" });
          await ctx.eval("[...document.querySelectorAll('[role=option]')].find(e=>['视频制作','Video'].includes(e.innerText.trim())).click()");
          for (const type of ["keyDown", "keyUp"]) await ctx.client.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
          await ctx.waitFor("document.querySelectorAll('[data-testid=project-agent-tab]').length===4", { label: "four roles" });
          await click(ctx, "[data-testid=project-agent-tab]");
          await ctx.waitFor("Boolean(document.querySelector('[data-testid=project-agent-inspector]'))", { label: "actual role details" });
        },
        assert: async () => {
          const work = (await request(ctx, sessionPath("/workflow"))).item;
          ctx.assert(work.execution.workflow.templateVersion === 4, "Current video template is bound");
          ctx.assert(work.execution.workflow.config.agents.every((agent) => agent.prompt.length > 100 && agent.skillIds.length > 0 && agent.pluginIds.includes("video-agent")), "Every role has instructions and installed video resource identities");
          await ctx.expectText("ipollowork-video-studio");
        },
        screenshot: { name: "video-role-instructions-and-skills", requireText: ["视频制作", "ipollowork-video-studio"] },
      });
      for (const type of ["keyDown", "keyUp"]) await ctx.client.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    } },
    { name: "Storyboard-only work actually uses its native worker", run: async (ctx) => {
      await ctx.prove("Storyboard-only work delegates plan and preserves the existing source", {
        voiceover: vo[1],
        action: async () => { await send(ctx, storyboardRequest); await waitForRoles(ctx, ["plan"]); await openConversation(ctx); },
        assert: async () => {
          const { delegations } = await waitForRoles(ctx, ["plan"]);
          ctx.assert(delegations.every((d) => d.role === "plan"), "Script-only request does not start production or verification workers");
          const template = await request(ctx, `/workspace/${wid}/template-sessions/${state.sid}-artifact-video`);
          state.entry = template.state.entry;
          const child = (await request(ctx, `/workspace/${wid}/sessions/${delegations[0].sid}/snapshot`)).item;
          const skills = child.messages.flatMap((m) => m.parts).filter((p) => p.tool === "skill").map((p) => p.state.input.name);
          ctx.assert(skills.includes("ipollowork-video-storyboard"), "The actual planning worker loads its professional Skill");
          const path = state.entry.replace(/index.html$/, "STORYBOARD.md");
          const file = await request(ctx, `/workspace/${wid}/files/content?path=${encodeURIComponent(path)}`);
          ctx.assert(file.content.includes("## Frame") && file.content.includes("- duration:"), "Native editable storyboard was actually saved");
          ctx.log(`Storyboard: ${path}; child: ${delegations[0].sid}; skills: ${skills.join(", ")}`);
        },
        screenshot: { name: "actual-storyboard-worker", requireText: ["STORYBOARD.md"] },
      });
    } },
    { name: "Production and review receive the same actual project", run: async (ctx) => {
      await ctx.prove("The main conversation collects production and independent review results", {
        voiceover: vo[2],
        action: async () => { await send(ctx, productionRequest); await waitForRoles(ctx, ["plan", "produce", "verify"]); await openConversation(ctx); },
        assert: async () => {
          const { snapshot, delegations } = await waitForRoles(ctx, ["plan", "produce", "verify"]);
          for (const role of ["produce", "verify"]) {
            const worker = delegations.find((d) => d.role === role);
            const child = (await request(ctx, `/workspace/${wid}/sessions/${worker.sid}/snapshot`)).item;
            ctx.assert(child.session.parentID === state.sid, `${role} is a native child of this exact conversation`);
            const parts = child.messages.flatMap((m) => m.parts);
            if (role === "produce") {
              const skills = parts.filter((p) => p.tool === "skill").map((p) => p.state.input.name);
              ctx.assert(skills.includes("ipollowork-video-compose"), "The production worker loads Compose");
              ctx.assert(!skills.includes("ipollowork-video-voiceover") && !skills.includes("ipollowork-video-soundtrack"), "This explicitly silent task does not preload voice or soundtrack Skills");
            }
            ctx.assert(!parts.some((p) => p.type === "tool" && /video_render_start|voiceover_timeline_validate/.test(JSON.stringify(p.state.input))), `${role} does not duplicate the app's render or aggregate gate`);
          }
          const calls = snapshot.messages.flatMap((m) => m.parts).filter((p) => p.tool === "task");
          ctx.assert(calls.every((p) => p.state.input.task_id || p.state.input.prompt.includes(state.entry.replace(/\/index.html$/, ""))), "Workers receive the original project rather than creating child-ID projects");
          ctx.log(`Real delegations: ${JSON.stringify(delegations)}`);
        },
        screenshot: { name: "production-and-review-returned", requireText: ["STORYBOARD.md"] },
      });
    } },
    { name: "Overview attributes actual children and retains review state", run: async (ctx) => {
      await ctx.prove("Overview displays real executed roles without accepting the deliverable", {
        voiceover: vo[3],
        action: async () => {
          await click(ctx, "[data-testid=session-header-project-overview]");
          await ctx.waitFor("document.querySelector('[data-testid=project-overview]')?.innerText.includes('策划与分镜')", { label: "live role usage" });
        },
        assert: async () => {
          const metric = await ctx.eval(`(async()=>{const d=await import('/src/app/lib/desktop.ts'),i=await d.ipolloworkServerInfo();const {createiPolloWorkServerClient}=await import('/src/app/lib/ipollowork-server.ts');const c=createiPolloWorkServerClient({baseUrl:i.baseUrl,token:i.ownerToken||i.clientToken,hostToken:i.hostToken});const w=(await c.getConversationWorkflow('${wid}','${state.sid}')).item;const {loadProjectRuntimeMetrics}=await import('/src/react-app/domains/work/project-runtime-metrics.ts');const m=await loadProjectRuntimeMetrics({client:c,workspaceId:'${wid}',agents:w.execution.workflow.config.agents,items:[w]});return {workStatus:w.status,agents:m.agents,executions:m.executionRecords};})()`, { awaitPromise: true });
          ctx.assert(metric.workStatus === "review", "The user has not accepted this test clip");
          for (const role of ["plan", "produce", "verify"]) ctx.assert(metric.agents.find((a) => a.agentId === role)?.tokens > 0, `${role} has actual attributed usage`);
          ctx.log(`Attributed runtime: ${JSON.stringify(metric)}`);
          await ctx.expectText("播放与检查");
        },
        screenshot: { name: "actual-video-team-overview", requireText: ["策划与分镜", "素材与制作", "播放与检查"] },
      });
    } },
  ],
};
