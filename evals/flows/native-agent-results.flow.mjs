import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("native-agent-results");
const opencode = { wid: process.env.IPOLLOWORK_OPENCODE_RESULTS_WORKSPACE_ID };
const temporarySessionId = process.env.IPOLLOWORK_TEMPORARY_AGENTS_SESSION_ID;
const planningFixtures = new Map();
const replayCooperation = process.env.IPOLLOWORK_NATIVE_COOPERATION_REPLAY === "1";

function turnMessages(snapshot, requestId) {
  const native = snapshot.messages.filter(message => message.info.parentID === requestId);
  if (native.length) return native;
  const start = snapshot.messages.findIndex(message => message.info.id === requestId);
  if (start < 0) return [];
  const tail = snapshot.messages.slice(start + 1);
  const end = tail.findIndex(message => message.info.role === "user");
  return end < 0 ? tail : tail.slice(0, end);
}

export async function request(ctx, path, method = "GET", body) {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await ctx.eval(`(async()=>{const d=await import('/src/app/lib/desktop.ts'),i=await d.ipolloworkServerInfo();const r=await fetch(i.baseUrl+${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{Authorization:'Bearer '+(i.ownerToken||i.clientToken),'x-ipollowork-host-token':i.hostToken,'content-type':'application/json'},${body === undefined ? "" : `body:JSON.stringify(${JSON.stringify(body)}),`}signal:AbortSignal.timeout(15000)});return {ok:r.ok,data:await r.json()};})()`, { awaitPromise: true });
      ctx.assert(result.ok, `${method} ${path}: ${JSON.stringify(result.data).slice(0, 300)}`);
      return result.data;
    } catch (error) {
      if (method !== "GET" || attempt >= 2 || !/timed out|TimeoutError|AbortError/i.test(String(error))) throw error;
      ctx.log(`Retrying transient native read: ${path}`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

export async function click(ctx, selector) {
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, { label: selector });
  await ctx.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});e.click();return true;})()`);
}

export async function open(ctx, fixture) {
  if (await ctx.eval("Boolean(document.querySelector('[data-testid=project-agent-inspector]'))")) {
    await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  }
  const snapshot = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/snapshot`)).item;
  await ctx.navigateHash(`/workspace/${fixture.wid}/session/${fixture.sid}`);
  await ctx.waitFor(`location.hash.endsWith('/session/${fixture.sid}') && (Boolean(document.querySelector('[data-session-surface-id="${fixture.sid}"]')) || [...document.querySelectorAll('h1')].some(e=>e.innerText===${JSON.stringify(snapshot.session.title)}))`, { label: "route has rendered" });
  await click(ctx, "[data-testid=session-header-work-conversation]");
  await ctx.waitFor(`Boolean(document.querySelector('[data-session-surface-id="${fixture.sid}"]'))`, { label: "correct native conversation" });
}

async function storyboard(ctx, fixture) {
  const template = await request(ctx, `/workspace/${fixture.wid}/template-sessions/${fixture.sid}-artifact-video`);
  const path = template.state.entry.replace(/index.html$/, "STORYBOARD.md");
  ctx.assert(path.startsWith(`video/${fixture.sid}-artifact-video/`), "The storyboard belongs to the actual root-owned video project");
  const file = await request(ctx, `/workspace/${fixture.wid}/files/content?path=${encodeURIComponent(path)}`);
  ctx.assert(file.content.includes("## Frame") && file.content.includes("- duration:"), "Actual native storyboard exists");
  const selector = `[data-chat-transcript] [data-artifact-path="${path}"], [data-chat-transcript] button[data-ipollowork-link-href$="/${path}"]`;
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, { label: "root-owned storyboard card", timeoutMs: 30000 });
  await ctx.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
  return path;
}

function isRoleTask(part, role) {
  const description = part.state?.input?.description ?? "";
  return part.state?.input?.subagent_type === `ipw-video.${role}` || description.includes(`ipw-video.${role}`)
    || description.includes(`[project-agent:${role}]`)
    || description.split("/").some(segment => segment === role || segment.startsWith(`${role}__`));
}

export async function allowFixtureWorkflowAccess(ctx, fixture, engineId) {
  if (engineId !== "codex-harness") return;
  const pending = await ctx.eval(`(async()=>{const d=await import('/src/app/lib/desktop.ts'),i=await d.ipolloworkServerInfo();const {CodexHarnessClient}=await import('/src/app/lib/codex-harness-client.ts');const c=new CodexHarnessClient({serverBaseUrl:i.baseUrl,workspaceId:${JSON.stringify(fixture.wid)},token:i.ownerToken||i.clientToken});return await c.call('ipollowork/pendingRequests');})()`, { awaitPromise: true });
  for (const approval of pending) {
    const params = approval.params;
    if (approval.method !== "mcpServer/elicitation/request" || !params?.threadId) continue;
    const caller = params.threadId === fixture.sid ? fixture : { wid: fixture.wid, sid: params.threadId };
    if (caller.sid !== fixture.sid) {
      const child = (await request(ctx, `/workspace/${fixture.wid}/sessions/${caller.sid}/snapshot`)).item;
      if (child.session.parentID !== fixture.sid || !child.session.codex?.subagent) continue;
    }
    const tool = ["ipollowork_conversation_read", "ipollowork_conversation_apply", "ipollowork_extension_list_actions", "ipollowork_extension_call"].find(name => params.message?.includes(`tool "${name}"`));
    const input = params._meta?.tool_params ?? {};
    const source = input.args?.sourcePath ?? input.args?.compositionPath;
    const localMediaAccess = input.extensionId === "media"
      && ["artifact_media_review", "video_component_install", "video_component_check", "video_audio_analyze", "video_delivery_check", "video_render_start", "video_render_status", "video_project_check", "voiceover_timeline_validate"].includes(input.action)
      && typeof source === "string" && source.startsWith(`video/${fixture.sid}-artifact-video/`) && !source.split("/").includes("..");
    const mediaCatalogAccess = input.extensionId === "media" && input.action === "video_recipe_catalog";
    ctx.assert(approval.method === "mcpServer/elicitation/request" && params.serverName === "ipollowork"
      && params._meta?.codex_approval_kind === "mcp_tool_call" && tool
      && (tool !== "ipollowork_extension_call" || localMediaAccess || mediaCatalogAccess),
    "Only this fixture's workflow, tool discovery or scoped local video checks can be accepted by the proof");
    if (!(await ctx.eval(`location.hash.endsWith('/session/${caller.sid}')`))) await open(ctx, caller);
    await ctx.waitFor(`document.body.innerText.includes(${JSON.stringify(params.message)}) && Boolean(document.querySelector('[data-testid=permission-allow-once]'))`, { label: "fixture workflow permission" });
    await click(ctx, "[data-testid=permission-allow-once]");
    ctx.log(`Accepted once for own fixture: ${tool}${tool === "ipollowork_extension_call" ? `/${input.action}` : ""}`);
    if (caller.sid !== fixture.sid) await open(ctx, fixture);
  }
}

async function nativePlan(ctx, engineId, narration) {
  let fixture;
  const reused = engineId === "opencode" ? process.env.IPOLLOWORK_OPENCODE_PLANNING_SESSION_ID : process.env.IPOLLOWORK_CODEX_PLANNING_SESSION_ID;
  await ctx.prove(`${engineId} natively delegates only storyboard work and returns its saved artifact`, {
    voiceover: narration,
    action: async () => {
      const created = reused ? null : await request(ctx, `/workspace/${opencode.wid}/sessions`, "POST", { title: `${engineId} 分镜协同实测 ${Date.now().toString(36)}`, engineId, model: { providerID: "openai", modelID: "gpt-6.1-sol" } });
      fixture = { wid: opencode.wid, sid: reused ?? created.item.id };
      ctx.log(`Native test root: ${JSON.stringify(fixture)}`);
      if (!reused) {
        const work = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/workflow`)).item;
        await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/workflow`, "PUT", { expectedVersion: work.version, runtime: work.execution.runtime, templateId: "video", source: "manual" });
      }
      await open(ctx, fixture);
      const text = "请使用视频模板现有的策划与分镜子Agent（原生角色 ipw-video.plan），先只制作一个6秒、16:9的工作助手宣传片分镜：一个想法变成清晰的下一步行动。三个场景，延续同一组原创可编辑图形。不要外部图片或视频，不要旁白、字幕、音乐和音效。先把原生分镜保存给我查看，不开始制作、不渲染、不导出。";
      if (!reused) await send(ctx, fixture, text);
      const deadline = Date.now() + 10 * 60_000;
      let finished = Boolean(reused);
      while (!finished && Date.now() < deadline) {
        await allowFixtureWorkflowAccess(ctx, fixture, engineId);
        const snap = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/snapshot`)).item;
        const w = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/workflow`)).item;
        if (snap.status.type === "idle" && (reused || w.status === "review")) { finished = true; break; }
        if (w.status === "failed") throw Error(`Native task failed: ${w.lastError}`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      ctx.assert(finished, "Native planning result returned within the deadline");
      await open(ctx, fixture);
      await storyboard(ctx, fixture);
    },
    assert: async () => {
      const snap = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/snapshot`)).item;
      const planningRequest = snap.messages.find(m => m.info.role === "user" && (m.parts ?? []).some(p => p.type === "text" && p.text.startsWith("请使用视频模板现有的策划与分镜子Agent")));
      ctx.assert(planningRequest, "The original script-only request is retained");
      const planningMessages = turnMessages(snap, planningRequest.info.id);
      const delegates = planningMessages.flatMap(m => m.parts ?? []).filter(p => p.tool === "task" && p.state.metadata?.sessionId);
      let task, child, childId;
      for (const id of [...new Set(delegates.map(p => p.state.metadata.sessionId))].slice(0, 8)) {
        const candidate = (await request(ctx, `/workspace/${fixture.wid}/sessions/${id}/snapshot`)).item;
        const delegate = delegates.find(p => p.state.metadata.sessionId === id && p.state.input?.subagent_type === "ipw-video.plan");
        if (candidate.session.codex?.agentRole === "ipw-video.plan" || delegate) {
          child = candidate; childId = id; task = delegate ?? delegates.find(p => p.state.metadata.sessionId === id); break;
        }
      }
      ctx.assert(task && child, "The actual native child uses the registered preset role ipw-video.plan");
      ctx.assert(child.session.parentID === fixture.sid, "Actual native child identity is retained");
      const tasks = planningMessages.flatMap(m => m.parts ?? []).filter(p => p.tool === "task");
      ctx.assert(!tasks.some(p => isRoleTask(p, "produce") || isRoleTask(p, "verify")), "Script-only work does not start unnecessary phases");
      if (!reused) ctx.assert(!snap.messages.some(m => m.info.role === "user" && (m.parts ?? []).some(p => p.type === "text" && p.text === "Continue the unfinished artifact delivery.")), "A requested storyboard stop does not trigger automatic production recovery");
      const calls = child.messages.flatMap(m => m.parts ?? []).filter(p => p.type === "tool");
      ctx.assert(calls.some(p => p.tool === "skill" && p.state.input?.name === "ipollowork-video-storyboard"
        || JSON.stringify(p.state.input ?? {}).includes('ipollowork-video-storyboard/SKILL.md')), "Planning worker loads its real professional Skill");
      const w = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/workflow`)).item;
      ctx.assert(w.execution.workflow.templateVersion === 6 && (reused || w.status === "review"), "The planning artifact uses the current template snapshot");
      ctx.log(`Actual planning child: ${childId}`);
    },
    screenshot: { name: `${engineId}-native-storyboard-returned`, requireText: ["分镜协同实测"], hashIncludes: "/session/" },
  });
  planningFixtures.set(engineId, fixture);
}

async function customizedRole(ctx, engineId, narration) {
  const fixture = planningFixtures.get(engineId);
  let marker = `当前角色校对_${engineId}_${Date.now().toString(36)}`;
  let requestId;
  await ctx.prove(`${engineId} combines a current conversation preset and a temporary native worker`, {
    voiceover: narration,
    action: async () => {
      const snapshot = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/snapshot`)).item;
      if (replayCooperation) {
        const work = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/workflow`)).item;
        marker = work.execution.workflow.config.agents.find(a=>a.id==='plan').prompt.match(new RegExp(`当前角色校对_${engineId}_[a-z0-9]+`))?.[0];
        requestId = snapshot.messages.filter(m=>m.info.role==='user' && (m.parts??[]).some(p=>p.type==='text'&&p.text.startsWith('现在只做一次只读校对'))).at(-1)?.info.id;
        ctx.assert(marker && requestId && work.execution.workflow.source==='custom', "Replay uses the persisted current role and its actual submitted request");
        await open(ctx, fixture);
        await click(ctx, "[data-testid=session-header-project-overview]");
        await click(ctx, '[data-testid=project-agent-tab][data-agent-id=plan]');
        await ctx.waitFor(`document.querySelector('[data-testid=project-agent-inspector]')?.innerText.includes(${JSON.stringify(marker)}) && Boolean(document.querySelector('[data-testid=project-agent-native-runtime]'))`, { label: "persisted current role rendered" });
        ctx.assert(await ctx.eval(`document.querySelector('[data-testid=project-agent-inspector]')?.innerText.includes(${JSON.stringify(marker)}) && Boolean(document.querySelector('[data-testid=project-agent-native-runtime]'))`), "The inspector retains the exact instructions used by the completed native worker");
        await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await ctx.waitFor("!document.querySelector('[data-testid=project-agent-inspector]')", { label: "role inspector closed" });
        await open(ctx, fixture);
        ctx.log(`Read-only replay of completed cooperation: ${requestId}; no new task or role mutation`);
        return;
      }
      await open(ctx, fixture);
      await click(ctx, "[data-testid=session-header-project-overview]");
      await ctx.waitFor("Boolean(document.querySelector('[data-testid=project-agent-tab]'))", { label: "preset roles in overview" });
      await click(ctx, '[data-testid=project-agent-tab][data-agent-id=plan]');
      await click(ctx, "[data-testid=project-agent-edit]");
      ctx.assert(await ctx.eval("Boolean(document.querySelector('[data-testid=project-agent-native-runtime]')) && !document.querySelector('[data-testid=project-agent-engine-select]') && !document.querySelector('[data-testid=project-agent-mode-select]')"), "Preset runtime inherits the native conversation without ignored engine or mode selectors");
      const prompt = await ctx.eval("document.querySelector('#project-agent-prompt').value.split('\\n本次只读校对')[0]");
      const extra = `\n本次只读校对，不修改任何文件。必须在返回结果中包含校对识别词：${marker}。`;
      await ctx.eval("(()=>{const e=document.querySelector('#project-agent-prompt');e.focus();e.select();})()");
      await ctx.client.send("Input.insertText", { text: prompt + extra });
      await ctx.waitFor(`document.querySelector('#project-agent-prompt')?.value.includes(${JSON.stringify(marker)})`, { label: "current role instruction edited" });
      await click(ctx, "[data-testid=project-agent-save]");
      await ctx.waitFor("!document.querySelector('[data-testid=project-agent-save]')", { label: "role saved and inspector closed", timeoutMs: 30000 });
      const work = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/workflow`)).item;
      ctx.assert(work.execution.workflow.source === "custom" && work.execution.workflow.config.agents.find(a=>a.id==='plan').prompt.includes(marker), "Conversation owns the edited role, including its exact new instructions");
      await open(ctx, fixture);
      await send(ctx, fixture, "现在只做一次只读校对，不进入制作：使用原生子 Agent 承接我刚修改的脚本与分镜预设，把当前角色指令、Skills 和 [project-agent:plan] 标记传给它，让它核对已有 STORYBOARD.md 的内容覆盖并交回结果。同时用另一名原生临时子 Agent 独立核对同一分镜的场景数量和总时长，不使用任何预设角色标记。两个任务都只读、可以并行。收回两个子 Agent 的结果后在主对话给我各自结论，不修改文件、不制作、不渲染。");
      const submitted = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/snapshot`)).item;
      requestId = submitted.messages.filter(m=>m.info.role==='user' && (m.parts??[]).some(p=>p.type==='text'&&p.text.startsWith('现在只做一次只读校对'))).at(-1)?.info.id;
      ctx.assert(requestId, "The submitted native request has a persisted identity");
      const deadline = Date.now() + 10 * 60_000;
      let finished = false;
      while (Date.now() < deadline) {
        await allowFixtureWorkflowAccess(ctx, fixture, engineId);
        const snap = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/snapshot`)).item;
        const work = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/workflow`)).item;
        if (turnMessages(snap, requestId).some(m=>m.info.role==='assistant' && m.info.time?.completed && (m.parts??[]).some(p=>p.type==='text'&&p.text.includes(marker)))) { finished = true; break; }
        if (work.status === "failed") throw Error(`Native cooperation failed: ${work.lastError}`);
        await new Promise(resolve=>setTimeout(resolve, 3000));
      }
      ctx.assert(finished, "Both native results return within the deadline");
      await open(ctx, fixture);
    },
    assert: async () => {
      const snap = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/snapshot`)).item;
      const messages = turnMessages(snap, requestId);
      ctx.assert(messages.some(m=>m.info.role==='assistant' && m.info.time?.completed && (m.parts??[]).some(p=>p.type==='text'&&p.text.includes(marker))), "The native main Agent completed this exact request and integrated its current result");
      const tasks = messages.flatMap(m=>m.parts??[]).filter(p=>p.tool==='task'&&p.state.metadata?.sessionId);
      const ids = [...new Set(tasks.map(p=>p.state.metadata.sessionId))];
      ctx.assert(ids.length >= 2, "Current preset and temporary work create distinct real native children");
      let customChild;
      for (const id of ids) {
        const child = (await request(ctx, `/workspace/${fixture.wid}/sessions/${id}/snapshot`)).item;
        ctx.assert(child.session.parentID === fixture.sid, "Cooperating children belong to the actual root conversation");
        const messages = child.messages.filter(m=>m.info.role==='assistant').flatMap(m=>m.parts??[]);
        ctx.assert(messages.some(p=>p.type==='tool' && p.state?.status==='completed' && /STORYBOARD\.md/.test(JSON.stringify(p.state.input??{}))), "Each reviewer actually reads the assigned file before reporting checks");
        if (messages.some(p=>p.type==='text' && p.text.includes(marker))) customChild = id;
      }
      ctx.assert(customChild, "A native child receives and returns the new preset instruction instead of the library's older prompt");
      ctx.assert(snap.messages.some(m=>m.info.role==='assistant'&&(m.parts??[]).some(p=>p.type==='text'&&p.text.includes(marker))), "Main Agent integrates the customized child's actual result");
      await click(ctx, "[data-testid=session-header-project-overview]");
      const metrics = await ctx.eval(`(async()=>{const d=await import('/src/app/lib/desktop.ts'),i=await d.ipolloworkServerInfo();const {createiPolloWorkServerClient}=await import('/src/app/lib/ipollowork-server.ts');const {loadProjectRuntimeMetrics}=await import('/src/react-app/domains/work/project-runtime-metrics.ts');const c=createiPolloWorkServerClient({baseUrl:i.baseUrl,token:i.ownerToken||i.clientToken,hostToken:i.hostToken});const item=(await c.getConversationWorkflow(${JSON.stringify(fixture.wid)},${JSON.stringify(fixture.sid)})).item;return await loadProjectRuntimeMetrics({client:c,workspaceId:${JSON.stringify(fixture.wid)},agents:item.execution.workflow.config.agents,items:[item]});})()`, { awaitPromise: true });
      ctx.assert(metrics.executionRecords.some(r=>r.sessionId===customChild&&r.agentId==='plan'), "Customized native worker is associated with the current preset in the display layer");
      const temporary = metrics.executionRecords.find(r=>ids.includes(r.sessionId)&&r.agentId===null);
      ctx.assert(temporary, "An independent native worker remains temporary without becoming a preset definition");
      const selector = `[data-testid=project-native-agent][href$="/session/${temporary.sessionId}"]`;
      await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)})) && Boolean(document.querySelector('[data-testid=project-agent-tab][data-agent-id=plan]'))`, { label: "preset and temporary executions together", timeoutMs: 45000 });
      await ctx.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      ctx.log(`Current preset child: ${customChild}; cooperating native children: ${ids.join(', ')}`);
    },
    screenshot: { name: `${engineId}-preset-temporary-cooperation`, requireText: ["参考分工", "预设"], hashIncludes: fixture.sid },
  });
}

export async function send(ctx, fixture, text) {
  const surface = `[data-session-surface-id="${fixture.sid}"]`;
  const editor = `${surface} [contenteditable=true][data-lexical-editor=true]`;
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(editor)})) && !document.querySelector('${surface} button[title="停止"]')`, { label: "native run has settled before a new prompt", timeoutMs: 10 * 60_000 });
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(editor)})) && location.hash.endsWith('/session/${fixture.sid}')`, { label: "correct root composer" });
  await ctx.eval(`(()=>{const e=document.querySelector(${JSON.stringify(editor)});e.focus();const range=document.createRange();range.selectNodeContents(e);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return true;})()`);
  await ctx.client.send("Input.insertText", { text });
  await ctx.waitFor(`document.querySelector(${JSON.stringify(editor)})?.innerText.includes(${JSON.stringify(text.slice(0, 12))})`, { label: "task pasted" });
  await click(ctx, `${surface} button[title="运行任务"]:not(:disabled)`);
  await ctx.waitFor(`document.querySelector('${surface} [data-chat-transcript]')?.innerText.includes(${JSON.stringify(text.slice(0, 18))})`, { label: "task submitted" });
}

export default {
  id: "native-agent-results", title: "Native OpenCode and Codex results remain owned by the main conversation", kind: "user-facing",
  requiredEnv: ["IPOLLOWORK_OPENCODE_RESULTS_WORKSPACE_ID", "IPOLLOWORK_TEMPORARY_AGENTS_SESSION_ID"],
  steps: [
    { name: "OpenCode script-only native execution", run: ctx => nativePlan(ctx, "opencode", vo[0]) },
    { name: "Codex script-only native execution", run: ctx => nativePlan(ctx, "codex-harness", vo[1]) },
    { name: "Codex uses the edited preset with a temporary native worker", run: ctx => customizedRole(ctx, "codex-harness", vo[3]) },
    { name: "Engine-created workers appear alongside preset roles", run: async ctx => {
      const fixture = { wid: opencode.wid, sid: temporarySessionId };
      let childId;
      let originalConfig;
      await ctx.prove("A real temporary native worker appears in the existing Agent panel and opens its actual conversation", {
        voiceover: vo[4],
        action: async () => {
          const snap = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/snapshot`)).item;
          const task = snap.messages.flatMap(m => m.parts ?? []).find(p => p.tool === "task" && p.state.metadata?.sessionId && p.state.input?.subagent_type === "explore");
          ctx.assert(task, "A real non-preset native explore worker was created by this root");
          childId = task.state.metadata.sessionId;
          const child = (await request(ctx, `/workspace/${fixture.wid}/sessions/${childId}/snapshot`)).item;
          ctx.assert(child.session.parentID === fixture.sid, "The temporary worker belongs to this exact native parent");
          originalConfig = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/workflow`)).item.execution.workflow.config;
          await open(ctx, fixture);
          await click(ctx, "[data-testid=session-header-project-overview]");
          const selector = `[data-testid=project-agent-activity-panel] [data-testid=project-native-agent][href$="/session/${childId}"]`;
          await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, { label: "temporary worker in the actual Agent panel", timeoutMs: 45000 });
          ctx.assert(await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(selector)})?.querySelector('[data-avatar-seed="${childId}"] svg[role="presentation"]'))`), "The temporary worker uses the same colorful avatar component as preset Agents");
          await click(ctx, selector);
          await ctx.waitFor(`location.hash.endsWith('/session/${childId}') && Boolean(document.querySelector('[data-chat-transcript]')) && [...document.querySelectorAll('h1')].some(e=>e.innerText===${JSON.stringify(child.session.title)})`, { label: "actual child transcript and native title", timeoutMs: 30000 });
          await open(ctx, fixture);
          await click(ctx, "[data-testid=session-header-project-overview]");
          await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, { label: "temporary worker remains displayed" });
          await ctx.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
        },
        assert: async () => {
          const config = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/workflow`)).item.execution.workflow.config;
          ctx.assert(JSON.stringify(config) === JSON.stringify(originalConfig), "Actual temporary workers do not alter preset definitions");
          ctx.assert(await ctx.eval(`document.querySelector('[data-testid=project-native-agent][href$="/session/${childId}"]')?.innerText.includes('引擎创建的子智能体')`), "The real temporary worker is visible in the Agent list");
          ctx.assert(await ctx.eval(`Boolean(document.querySelector('[data-testid=project-native-agent][href$="/session/${childId}"] [data-avatar-seed="${childId}"] svg[role="presentation"]'))`), "The generated avatar retains the same identity after reopening the overview");
        },
        screenshot: { name: "temporary-native-agent-panel", requireText: ["引擎创建的子智能体"], hashIncludes: fixture.sid },
      });
    } },
    { name: "OpenCode uses the edited preset with a temporary native worker", run: ctx => customizedRole(ctx, "opencode", vo[2]) },
  ],
};
