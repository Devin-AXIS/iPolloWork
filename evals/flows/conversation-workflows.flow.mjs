import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { request, click, open } from "./native-agent-results.flow.mjs";

const vo = await loadVoiceoverParagraphs("conversation-workflows");
const wid = process.env.IPOLLOWORK_OPENCODE_RESULTS_WORKSPACE_ID;
const fixtures = {
  opencode: { wid, sid: process.env.IPOLLOWORK_OPENCODE_PLANNING_SESSION_ID, children: process.env.IPOLLOWORK_OPENCODE_DISPLAY_CHILD_IDS?.split(",") },
  codex: { wid, sid: process.env.IPOLLOWORK_CODEX_PLANNING_SESSION_ID, children: process.env.IPOLLOWORK_CODEX_DISPLAY_CHILD_IDS?.split(",") },
};
const state = { previousHash: null, previousLanguage: null, fresh: null, child: null };
const prompt = "只回复两个汉字：就绪。无需创建文件或调用其他工具。";

async function restore(ctx) {
  await ctx.client.send("Emulation.clearDeviceMetricsOverride");
  if (state.previousLanguage !== null) await ctx.eval(`localStorage.setItem('ipollowork.language', ${JSON.stringify(state.previousLanguage)})`);
  if (state.previousHash) await ctx.navigateHash(state.previousHash.replace(/^#/, ""));
  if (!state.fresh) return;
  const fixture = state.fresh;
  const snapshot = (await request(ctx, `/workspace/${wid}/sessions/${fixture.sid}/snapshot`)).item;
  const userMessages = snapshot.messages.filter(m => m.info.role === "user");
  if (snapshot.status.type !== "idle" || userMessages.length !== 1
    || userMessages[0].parts.filter(p => p.type === "text").map(p => p.text).join("\n") !== prompt) {
    ctx.log("Proof conversation retained because it is running or has additional user work");
    return;
  }
  const work = (await request(ctx, `/workspace/${wid}/sessions/${fixture.sid}/workflow`)).item;
  ctx.assert(!work || work.execution?.sessionId === fixture.sid, "Cleanup is limited to this proof's own task");
  if (work) await request(ctx, `/workspace/${wid}/work-items/${work.id}?version=${work.version}`, "DELETE");
  await request(ctx, `/workspace/${wid}/sessions/${fixture.sid}`, "DELETE");
  state.fresh = null;
  ctx.log("Removed the completed proof-only conversation and its task");
}

function guarded(run) {
  return async (ctx) => {
    try { await run(ctx); } catch (error) { await restore(ctx).catch(() => {}); throw error; }
  };
}

async function overview(ctx, fixture) {
  await open(ctx, fixture);
  await click(ctx, "[data-testid=session-header-project-overview]");
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=project-agent-list]')) && !document.querySelector('[data-testid=project-runtime-data]')?.innerText.includes('正在统计')", { label: "actual conversation overview" });
  ctx.assert(await ctx.eval("(()=>{const h=document.querySelector('[data-testid=project-overview] > header');const t=h?.querySelector('h1');return t && !h.querySelector('p') && t.getBoundingClientRect().height<=32 && t.getBoundingClientRect().right<=h.getBoundingClientRect().right;})()"), "The overview header shows a single bounded title without repeating the user's full request");
}

async function assertActualAgents(ctx, fixture) {
  await ctx.waitFor(`${JSON.stringify(fixture.children)}.every(id => [...document.querySelectorAll('[data-testid=project-native-agent]')].some(e => e.dataset.sessionId === id))`, { timeoutMs: 60_000, label: "native workers have loaded" });
  const rows = await ctx.eval(`(()=>({
    main: document.querySelectorAll('[data-testid=project-primary-agent]').length,
    presets: document.querySelectorAll('[data-testid=project-agent-tab], [data-testid=project-agent-inspector], [data-testid=project-orchestration-graph], [data-testid=work-template-picker], [data-testid=conversation-save-template]').length,
    children: [...document.querySelectorAll('[data-testid=project-native-agent]')].map(e=>({id:e.dataset.sessionId,href:e.getAttribute('href'),avatar:e.querySelector('[data-avatar-seed]')?.dataset.avatarSeed,text:e.innerText})),
  }))()`);
  ctx.assert(rows.main === 1 && rows.presets === 0, "One actual main worker is shown without preset rows or controls");
  ctx.assert(new Set(rows.children.map(row => row.id)).size === rows.children.length, "Native children are not duplicated");
  const parent = (await request(ctx, `/workspace/${fixture.wid}/sessions/${fixture.sid}/snapshot`)).item;
  for (const childId of fixture.children) {
    const snapshot = (await request(ctx, `/workspace/${fixture.wid}/sessions/${childId}/snapshot`)).item;
    ctx.assert(snapshot.session.parentID === fixture.sid && snapshot.messages.length > 0, "The displayed worker has a real native parent and messages");
    const row = rows.children.find(row => row.id === childId);
    const delegation = parent.messages.flatMap(m => m.parts).find(p => p.tool === "task" && p.state.metadata?.sessionId === childId);
    const title = delegation?.state.input?.description ?? snapshot.session.title;
    ctx.assert(row?.href === `#/workspace/${fixture.wid}/session/${childId}` && row.avatar === childId && row.text.includes(title), "Native identity, title, colored avatar and transcript link are retained");
    ctx.assert(/已完成|进行中|失败|已记录/.test(row.text), "The actual worker has an observable execution status");
  }
  const usage = await ctx.eval(`(()=>({
    total: document.querySelector('[data-testid=project-runtime-data]').dataset.totalTokens,
    count: document.querySelector('[data-testid=project-runtime-data]').dataset.conversationCount,
    rows: [...document.querySelectorAll('[data-testid=project-agent-usage-row]')].map(e=>({id:e.dataset.sessionId,tokens:e.dataset.tokenCount,metered:e.dataset.metered,avatar:e.querySelector('[data-avatar-seed]')?.dataset.avatarSeed,text:e.innerText})),
  }))()`);
  const sessions = (await request(ctx, `/workspace/${fixture.wid}/sessions`)).items;
  const sessionTokens = session => session.tokens ? Math.max(0, session.tokens.input + session.tokens.output + session.tokens.reasoning + (session.tokens.cache?.read ?? 0) + (session.tokens.cache?.write ?? 0)) : null;
  ctx.assert(usage.rows.length === Number(usage.count) && new Set(usage.rows.map(row=>row.id)).size === usage.rows.length, "Each actual conversation is counted once in usage");
  ctx.assert([fixture.sid, ...rows.children.map(row=>row.id)].every(id=>usage.rows.some(row=>row.id===id)), "The main and every actual child are separately metered, including temporary agents");
  let total = 0, metered = 0;
  for (const row of usage.rows) {
    const session = sessions.find(session=>session.id===row.id);
    ctx.assert(session && row.avatar === row.id, "Usage uses the same actual session identity and avatar");
    const tokens = sessionTokens(session);
    if (tokens === null) ctx.assert(row.metered === "false" && row.tokens === undefined && row.text.includes("未计量"), "Missing native metering is explicitly unavailable rather than zero");
    else { ctx.assert(Number(row.tokens) === tokens, "Individual usage matches the engine's actual token metadata"); total += tokens; metered++; }
  }
  ctx.assert(metered ? Number(usage.total) === total : usage.total === undefined, "The summary sums only actual measured main and child usage, without double counting");
  ctx.log(`Observed ${rows.children.length} real children, ${metered}/${usage.rows.length} metered conversations, total ${metered ? total : "unavailable"} for ${fixture.sid}`);
}

export default {
  id: "conversation-workflows",
  title: "Direct conversation start and actual native collaborators",
  kind: "user-facing",
  steps: [
    {
      name: "Start directly without preset setup",
      run: guarded(async (ctx) => {
        await ctx.prove("A new conversation keeps engine selection and requires no work template or role setup", {
          voiceover: vo[0],
          action: async () => {
            ctx.assert(wid && Object.values(fixtures).every(f => f.sid && f.children?.length >= 2), "Provide existing OpenCode and Codex root/child fixture IDs");
            state.previousHash = await ctx.eval("location.hash");
            state.previousLanguage = await ctx.eval("localStorage.getItem('ipollowork.language')");
            const currentWorkspace = await ctx.eval("localStorage.getItem('ipollowork.react.activeWorkspace')");
            if (currentWorkspace !== wid) {
              for (const id of new Set([currentWorkspace, wid])) {
                const sessions = (await request(ctx, `/workspace/${id}/sessions`)).items;
                ctx.assert(sessions.every(session => session.status?.type !== "busy"), "Changing the displayed project is safe only when its native sessions are idle");
              }
            }
            for (const fixture of Object.values(fixtures)) {
              const snapshot = (await request(ctx, `/workspace/${wid}/sessions/${fixture.sid}/snapshot`)).item;
              ctx.assert(snapshot.status.type === "idle", "Existing human work must be idle before read-only display verification");
            }
            await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
            await ctx.navigateHash(`/workspace/${wid}/session`);
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=new-conversation-starter-composer-shell] [contenteditable=true]'))", { label: "new conversation composer" });
          },
          assert: async () => {
            ctx.assert(await ctx.eval("Boolean(document.querySelector('[data-testid=conversation-engine-picker]')) && !document.querySelector('[data-testid=work-template-picker]') && !document.querySelector('[data-testid=project-agent-inspector]')"), "Engine choice remains; preset selection is absent");
          },
          screenshot: { name: "direct-start", requireText: ["OpenCode"], rejectText: ["Something went wrong"] },
        });
      }),
    },
    {
      name: "A real native reply and overview",
      run: guarded(async (ctx) => {
        await ctx.prove("A direct prompt receives a real engine response and the overview shows only the main worker", {
          voiceover: vo[1],
          action: async () => {
            await ctx.eval("document.querySelector('[data-testid=new-conversation-starter-composer-shell] [contenteditable=true]').focus()");
            await ctx.client.send("Input.insertText", { text: prompt });
            await click(ctx, '[data-testid=new-conversation-starter-composer-shell] button[title="运行任务"]:not(:disabled)');
            const sid = await ctx.waitFor("location.hash.match(/\\/session\\/([^/?#]+)/)?.[1]", { timeoutMs: 60_000, label: "new native conversation" });
            state.fresh = { wid, sid };
            const deadline = Date.now() + 90_000;
            let finished = false;
            while (Date.now() < deadline) {
              const snapshot = (await request(ctx, `/workspace/${wid}/sessions/${sid}/snapshot`)).item;
              const reply = snapshot.messages.some(m => m.info.role === "assistant" && m.parts.some(p => p.type === "text" && p.text.includes("就绪")));
              if (snapshot.status.type === "idle" && reply) { finished = true; break; }
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            ctx.assert(finished, "The engine returned the requested reply and settled");
            const saved = (await request(ctx, `/workspace/${wid}/sessions/${sid}/snapshot`)).item;
            const context = saved.messages.find(m=>m.info.role === "user")?.info.system;
            ctx.assert(typeof context === "string" && context.includes("Proactively use native subagents") && context.includes("sequence dependent steps"), "The short adaptive delegation policy reached the actual native turn");
            await open(ctx, state.fresh);
            await ctx.expectText("就绪");
            await overview(ctx, state.fresh);
          },
          assert: async () => {
            const work = (await request(ctx, `/workspace/${wid}/sessions/${state.fresh.sid}/workflow`)).item;
            ctx.assert(work.execution.workflow.source === "auto", "Default start automatically keeps the task context");
            ctx.assert(await ctx.eval("document.querySelectorAll('[data-testid=project-primary-agent]').length === 1 && document.querySelectorAll('[data-testid=project-native-agent], [data-testid=project-agent-tab]').length === 0 && Boolean(document.querySelector('[data-testid=project-task-health]')) && Boolean(document.querySelector('[data-testid=project-runtime-data]'))"), "Old metric layout remains with one actual worker and no standby roles");
          },
          screenshot: { name: "real-reply-overview", requireText: ["主智能体", "任务健康"], rejectText: ["Something went wrong"] },
        });
      }),
    },
    {
      name: "OpenCode workers share the actual agent list",
      run: guarded(async (ctx) => {
        await ctx.prove("OpenCode displays real preset-associated and temporary workers together", {
          voiceover: vo[2],
          action: async () => {
            await overview(ctx, fixtures.opencode);
            await ctx.eval("document.querySelector('[data-testid=project-runtime-data]').scrollIntoView({block:'center'})");
          },
          assert: async () => { await assertActualAgents(ctx, fixtures.opencode); },
          screenshot: { name: "opencode-actual-workers", requireText: ["主智能体", "引擎创建的子智能体"], rejectText: ["Something went wrong", "保存为模板"] },
        });
      }),
    },
    {
      name: "Read the native child and return to scoped tasks",
      run: guarded(async (ctx) => {
        await ctx.prove("An actual child opens its native messages and the main task list remains conversation-scoped", {
          voiceover: vo[3],
          action: async () => {
            state.child = fixtures.opencode.children[1];
            await click(ctx, `[data-testid=project-native-agent][data-session-id="${state.child}"]`);
            await ctx.waitFor(`location.hash.endsWith('/session/${state.child}')`, { label: "actual child route" });
            await open(ctx, { wid, sid: state.child });
            const snapshot = (await request(ctx, `/workspace/${wid}/sessions/${state.child}/snapshot`)).item;
            const result = snapshot.messages.flatMap(m => m.info.role === "assistant" ? m.parts : []).find(p => p.type === "text" && p.text.trim().length > 20);
            ctx.assert(result, "A real child result exists");
            const visibleResult = result.text.replace(/[`*_#]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
            await ctx.expectText(visibleResult);
            await ctx.screenshot("actual-child-transcript", { voiceover: vo[3], claim: "The actual child transcript shows its saved result", requireText: [visibleResult], hashIncludes: `/session/${state.child}` });
            await overview(ctx, fixtures.opencode);
            await click(ctx, "[data-testid=session-header-work-tasks]");
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=work-center]'))", { label: "scoped task view" });
          },
          assert: async () => {
            const response = await request(ctx, `/work-items?workspaceId=${wid}&sessionId=${fixtures.opencode.sid}`);
            ctx.assert(response.items.some(item => item.execution?.sessionId === fixtures.opencode.sid), "The main conversation owns its actual work item");
            await ctx.expectHashIncludes(`/session/${fixtures.opencode.sid}`);
            ctx.assert(await ctx.eval("Boolean(document.querySelector('[data-testid=work-center]')) && !document.querySelector('[data-testid=project-agent-inspector]')"), "Tasks remain available without preset editing");
            await ctx.waitFor(`${JSON.stringify(fixtures.opencode.children)}.every(id=>[...document.querySelectorAll('[data-testid=project-task-executor]')].some(e=>e.dataset.sessionId===id))`, { label: "actual task executors" });
            const executors = await ctx.eval("[...document.querySelectorAll('[data-testid=project-task-executor]')].map(e=>({id:e.dataset.sessionId,seed:e.querySelector('[data-avatar-seed]')?.dataset.avatarSeed,size:e.querySelector('[data-avatar-seed]')?.getBoundingClientRect().width,text:e.innerText}))");
            ctx.assert(executors.some(e=>e.id===fixtures.opencode.sid), "The main task displays its actual executor");
            ctx.assert(executors.every(e=>e.id===e.seed && e.size>=36), "Every executed task uses a prominent actual-agent avatar that matches its overview identity");
            await ctx.eval(`document.querySelector('[data-testid=project-task-executor][data-session-id="${fixtures.opencode.sid}"]').scrollIntoView({block:'center',inline:'center'})`);
            ctx.assert(await ctx.eval(`(()=>{const a=document.querySelector('[data-testid=project-task-executor][data-session-id="${fixtures.opencode.sid}"] [data-avatar-seed]').getBoundingClientRect();return a.left>=0 && a.right<=innerWidth && a.top>=0 && a.bottom<=innerHeight;})()`), "The screenshot actually shows the task executor avatar");
          },
          screenshot: { name: "scoped-native-tasks", requireText: ["任务"], rejectText: ["Something went wrong"] },
        });
      }),
    },
    {
      name: "Codex uses the same actual-worker presentation",
      run: guarded(async (ctx) => {
        await ctx.prove("Codex displays actual associated and temporary children with individual usage and honest missing meters", {
          voiceover: vo[4],
          action: async () => {
            await overview(ctx, fixtures.codex);
            await ctx.eval("document.querySelector('[data-testid=project-runtime-data]').scrollIntoView({block:'center'})");
          },
          assert: async () => { await assertActualAgents(ctx, fixtures.codex); },
          screenshot: { name: "codex-actual-workers", requireText: ["Codex", "主智能体", "引擎创建的子智能体"], rejectText: ["Something went wrong", "保存为模板"] },
        });
      }),
    },
    {
      name: "Narrow display and retained future capability",
      run: guarded(async (ctx) => {
        await ctx.prove("At 520 pixels actual workers and controls fit; preset definitions remain available through the existing API", {
          voiceover: vo[5],
          action: async () => {
            await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 520, height: 900, deviceScaleFactor: 1, mobile: false });
            await ctx.waitFor("innerWidth === 520 && (()=>{const p=document.querySelector('[data-testid=conversation-workspace]'); const r=p?.getBoundingClientRect(); return r && r.left>=0 && r.right<=innerWidth && p.scrollWidth<=p.clientWidth+1;})()", { label: "narrow layout settled" });
          },
          assert: async () => {
            const templates = await request(ctx, `/workspace/${wid}/work-templates`);
            ctx.assert(templates.templates.some(t => t.id === "video" && t.config.agents.length > 1), "Stored template and specialist definitions are retained for future use");
            ctx.assert(await ctx.eval("(()=>{const p=document.querySelector('[data-testid=conversation-workspace]'); const r=p.getBoundingClientRect(); return [...p.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width>0).every(e=>{const c=e.getBoundingClientRect();return c.left>=r.left && c.right<=r.right+1;}) && !p.querySelector('[data-testid=project-agent-tab], [data-testid=work-template-picker]');})()"), "Visible actions fit without preset controls");
          },
          screenshot: { name: "actual-overview-narrow", requireText: ["任务健康"], rejectText: ["Something went wrong"] },
        });
        await click(ctx, "[data-testid=session-header-work-tasks]");
        await ctx.waitFor(`${JSON.stringify(fixtures.codex.children)}.every(id=>[...document.querySelectorAll('[data-testid=project-task-executor]')].some(e=>e.dataset.sessionId===id))`, { label: "narrow actual child task executors" });
        await ctx.eval(`document.querySelector('[data-testid=project-task-executor][data-session-id="${fixtures.codex.sid}"]').scrollIntoView({block:'center',inline:'center'})`);
        await ctx.waitFor(`[...document.querySelectorAll('[data-testid=project-task-executor]')].every(e=>{const r=e.getBoundingClientRect();const c=e.closest('article').getBoundingClientRect();const a=e.querySelector('[data-avatar-seed]').getBoundingClientRect();return r.left>=c.left && r.right<=c.right+1 && a.width>=36;})`, { label: "executor fits each narrow card" });
        ctx.assert(await ctx.eval(`(()=>{const a=document.querySelector('[data-testid=project-task-executor][data-session-id="${fixtures.codex.sid}"] [data-avatar-seed]').getBoundingClientRect();return a.left>=0 && a.right<=innerWidth && a.top>=0 && a.bottom<=innerHeight;})()`), "The narrow board shows a prominent actual executor after selecting its column");
        await ctx.screenshot("actual-tasks-narrow", { voiceover: vo[5], claim: "At 520 pixels actual task executor avatars remain readable and fit inside their cards", requireText: ["主智能体"], rejectText: ["Something went wrong"] });
        await restore(ctx);
      }),
    },
  ],
};
