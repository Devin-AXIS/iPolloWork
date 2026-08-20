/**
 * User-facing proof for the shared Work Item model: one saved item appears in
 * the global schedule and in its owning project's board.
 */
const ITEM_TITLE = "跨项目发布检查";
const EXECUTION_TITLE = "真实执行绑定检查";

let fixture = null;
let builderSessionId = null;

async function prepareFixture(ctx) {
  await ctx.eval(`(() => {
    [...document.querySelectorAll('[role="dialog"]')].reverse().forEach((dialog) => {
      const cancel = [...dialog.querySelectorAll("button")].find((button) => button.textContent?.trim() === "取消");
      cancel?.click();
    });
    document.querySelector('[data-slot="sheet-close"]')?.click();
    const back = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "返回应用");
    back?.click();
    return true;
  })()`);
  await ctx.waitFor('!document.querySelector(\'[role="dialog"]\')', { label: "no blocking dialog" });
  await ctx.waitFor('!document.querySelector("[data-testid=project-agent-inspector]")', { label: "no blocking Agent inspector" });
  await ctx.waitFor('[...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "日程")', { label: "main application navigation" });
  fixture = await ctx.eval(`(async () => {
    const port = localStorage.getItem("ipollowork.server.port") || "";
    const baseUrl = localStorage.getItem("ipollowork.server.urlOverride")
      || localStorage.getItem("ipollowork.server.active")
      || (port ? "http://127.0.0.1:" + port : "");
    const token = localStorage.getItem("ipollowork.server.token") || "";
    const workspaceId = location.hash.match(/\\/workspace\\/([^/]+)/)?.[1]
      || localStorage.getItem("ipollowork.react.activeWorkspace")
      || "";
    if (!baseUrl || !token || !workspaceId) throw new Error("Active project server context is unavailable");
    const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
    const builderStorageKey = "ipollowork.project-builder-sessions.v1";
    try {
      const builderSessions = JSON.parse(localStorage.getItem(builderStorageKey) || "[]");
      for (const builder of builderSessions.filter((item) => item.workspaceId === workspaceId)) {
        await fetch(
          baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/sessions/" + encodeURIComponent(builder.sessionId),
          { method: "DELETE", headers },
        );
      }
      localStorage.setItem(builderStorageKey, JSON.stringify(builderSessions.filter((item) => item.workspaceId !== workspaceId)));
    } catch {}
    const listResponse = await fetch(baseUrl + "/work-items?workspaceId=" + encodeURIComponent(workspaceId), { headers });
    if (!listResponse.ok) throw new Error("Could not read project tasks: " + listResponse.status);
    const existing = await listResponse.json();
    for (const item of existing.items.filter((candidate) => [
      ${JSON.stringify(ITEM_TITLE)},
      ${JSON.stringify(EXECUTION_TITLE)},
    ].includes(candidate.title))) {
      const response = await fetch(
        baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/work-items/" + encodeURIComponent(item.id) + "?version=" + item.version,
        { method: "DELETE", headers },
      );
      if (!response.ok) throw new Error("Could not remove stale proof task: " + response.status);
    }
    const now = Date.now();
    const createResponse = await fetch(baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/work-items", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: ${JSON.stringify(ITEM_TITLE)},
        description: "验证总日程与项目任务使用同一数据源",
        status: "planned",
        priority: "normal",
        assignee: "project-lead",
        startAt: now,
        dueAt: now + 60 * 60 * 1000,
        customFields: {},
      }),
    });
    if (!createResponse.ok) throw new Error("Could not create proof task: " + createResponse.status);
    const item = await createResponse.json();

    const workspacesResponse = await fetch(baseUrl + "/workspaces", { headers });
    if (!workspacesResponse.ok) throw new Error("Could not read project engine: " + workspacesResponse.status);
    const workspacesPayload = await workspacesResponse.json();
    const workspaces = Array.isArray(workspacesPayload)
      ? workspacesPayload
      : Array.isArray(workspacesPayload.workspaces) ? workspacesPayload.workspaces : [];
    const engineId = workspaces.find((workspace) => workspace.id === workspaceId)?.engineId || "opencode";
    const runtimeSessionId = "fraimz_execution_" + Date.now();
    const startResponse = await fetch(
      baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/project-sessions/" + encodeURIComponent(runtimeSessionId) + "/execution",
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          title: ${JSON.stringify(EXECUTION_TITLE)},
          runtime: { engineId, model: null, mode: null, modelVariant: null },
        }),
      },
    );
    if (!startResponse.ok) throw new Error("Could not bind proof execution: " + startResponse.status);
    const started = await startResponse.json();
    const finishResponse = await fetch(
      baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/project-sessions/" + encodeURIComponent(runtimeSessionId) + "/execution",
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "done", title: ${JSON.stringify(EXECUTION_TITLE)} }),
      },
    );
    if (!finishResponse.ok) throw new Error("Could not finish proof execution: " + finishResponse.status);
    const finished = await finishResponse.json();
    if (!finished.execution || finished.execution.runtime.engineId !== engineId) {
      throw new Error("The proof task did not preserve its execution binding");
    }
    return {
      baseUrl,
      token,
      workspaceId,
      items: [
        { id: item.id, version: item.version },
        { id: finished.id, version: finished.version },
      ],
    };
  })()`, { awaitPromise: true });
  ctx.assert(fixture?.items?.length === 2, "Expected manual and execution-bound proof tasks.");
}

async function cleanupFixture(ctx) {
  if (!fixture) return;
  if (builderSessionId) {
    await ctx.eval(`fetch(
      ${JSON.stringify(fixture.baseUrl)} + "/workspace/" + encodeURIComponent(${JSON.stringify(fixture.workspaceId)}) + "/sessions/" + encodeURIComponent(${JSON.stringify(builderSessionId)}),
      { method: "DELETE", headers: { authorization: "Bearer " + ${JSON.stringify(fixture.token)} } },
    ).then(() => {
      const key = "ipollowork.project-builder-sessions.v1";
      try {
        const items = JSON.parse(localStorage.getItem(key) || "[]");
        localStorage.setItem(key, JSON.stringify(items.filter((item) => item.sessionId !== ${JSON.stringify(builderSessionId)})));
      } catch {}
      return true;
    })`, { awaitPromise: true });
    builderSessionId = null;
  }
  const result = await ctx.eval(`Promise.all(${JSON.stringify(fixture.items)}.map((item) => fetch(
    ${JSON.stringify(fixture.baseUrl)} + "/workspace/" + encodeURIComponent(${JSON.stringify(fixture.workspaceId)}) + "/work-items/" + encodeURIComponent(item.id) + "?version=" + item.version,
    { method: "DELETE", headers: { authorization: "Bearer " + ${JSON.stringify(fixture.token)} } },
  ).then((response) => response.ok))).then((results) => results.every(Boolean))`, { awaitPromise: true });
  ctx.assert(result === true, "Expected the temporary project task to be removed.");
  fixture = null;
}

function clickButtonExpression(label) {
  return `(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) throw new Error(${JSON.stringify(`Button not found: ${label}`)});
    button.click();
    return true;
  })()`;
}

export default {
  id: "work-schedule-board",
  title: "One work item connects the global schedule and project board",
  kind: "user-facing",
  steps: [
    {
      name: "Open the global schedule",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 30_000,
          label: "iPolloWork control API",
        });
        await prepareFixture(ctx);
        await ctx.prove("The sidebar opens a global, cross-project schedule", {
          voiceover: "From the main sidebar, Schedule opens one calm time view for work across every project.",
          action: async () => {
            await ctx.eval(clickButtonExpression("日程"));
            await ctx.waitFor('document.body.innerText.includes("在同一时间视图中查看所有项目的计划与进度。")', {
              label: "global schedule",
            });
          },
          assert: async () => {
            await ctx.expectText("新建日程");
            await ctx.expectText("时间按 Asia/Singapore 显示");
          },
          screenshot: {
            name: "global-week-schedule",
            requireText: ["日程", "新建日程", ITEM_TITLE],
          },
        });
      },
    },
    {
      name: "Switch to the month view",
      run: async (ctx) => {
        await ctx.prove("The same schedule can be read as a compact month", {
          voiceover: "The month switch keeps the same source of truth and turns it into a compact planning overview.",
          action: async () => {
            await ctx.eval(clickButtonExpression("月"));
            await ctx.waitFor(`document.body.innerText.includes(${JSON.stringify(ITEM_TITLE)})`, {
              label: "scheduled work item in month view",
            });
          },
          assert: async () => {
            await ctx.expectText(ITEM_TITLE);
          },
          screenshot: {
            name: "global-month-schedule",
            requireText: ["周一", "周日", ITEM_TITLE],
          },
        });
      },
    },
    {
      name: "Open the current project's overview",
      run: async (ctx) => {
        await ctx.prove("The project overview turns shared task data into one readable health view", {
          voiceover: "Back in the project, Overview brings the Agent team, total work, waiting work, completion, and failure health into one calm surface.",
          action: async () => {
            await ctx.eval(`(() => {
              const button = [...document.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === "关闭");
              if (!button) throw new Error("Schedule close button not found");
              button.click();
              return true;
            })()`);
            await ctx.waitFor('Boolean(document.querySelector("[data-testid=session-header-work-tasks]"))', {
              label: "project task navigation",
            });
            await ctx.eval('document.querySelector("[data-testid=session-header-project-overview]").click(); true');
            await ctx.waitFor(`Boolean(document.querySelector("[data-testid=project-overview]")) && document.body.innerText.includes(${JSON.stringify(ITEM_TITLE)})`, {
              label: "project overview with task health",
            });
          },
          assert: async () => {
            await ctx.expectText("任务健康");
            await ctx.expectText("全部任务");
            await ctx.expectText("等待");
            await ctx.expectText("已完成");
            await ctx.expectText("失败率");
            await ctx.expectText("Token 消耗");
            await ctx.expectText("智能体");
            await ctx.expectText("近期任务");
            await ctx.expectText(ITEM_TITLE);
            const agentCount = await ctx.eval('document.querySelectorAll("[data-testid=project-agent-tab]").length');
            ctx.assert(agentCount > 0, "Expected the project Agent list to be visible.");
            const agentSummary = await ctx.eval('document.querySelector("[data-testid=project-agent-task-summary]")?.textContent || ""');
            ctx.assert(
              ["执行中", "已完成", "失败"].every((label) => agentSummary.includes(label)) && !agentSummary.includes("等待"),
              "Expected the Agent summary to show only execution outcomes.",
            );
            const healthText = await ctx.eval('document.querySelector("[data-testid=project-task-health]")?.textContent || ""');
            ctx.assert(!healthText.includes("活跃任务"), "Default project health should not show the optional active metric.");
          },
          screenshot: {
            name: "project-overview",
            requireText: ["概览", "任务健康", "全部任务", "等待", "已完成", "失败率", "Token 消耗", "智能体", "近期任务", ITEM_TITLE],
          },
        });
      },
    },
    {
      name: "Inspect the primary Agent in view mode",
      run: async (ctx) => {
        await ctx.prove("An existing Agent opens in a safe read-only inspector", {
          voiceover: "Selecting an existing Agent first opens a calm read-only summary, so looking at its identity and runtime cannot accidentally change the project.",
          action: async () => {
            await ctx.eval('document.querySelector("[data-testid=project-agent-tab]").click(); true');
            await ctx.waitFor('Boolean(document.querySelector("[data-testid=project-agent-inspector]"))', {
              label: "project Agent inspector",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              edit: Boolean(document.querySelector('[data-testid="project-agent-edit"]')),
              nameInput: Boolean(document.querySelector('#project-agent-name')),
              engineSelect: Boolean(document.querySelector('[data-testid="project-agent-engine-select"]')),
              addPlugin: Boolean(document.querySelector('[data-testid="project-agent-add-plugin"]')),
              avatarDisabled: document.querySelector('[data-testid="project-agent-avatar"]')?.disabled === true,
            }))()`);
            ctx.assert(state.edit, "Expected an explicit edit action in view mode.");
            ctx.assert(!state.nameInput && !state.engineSelect && !state.addPlugin, "Expected mutation controls to stay hidden before editing.");
            ctx.assert(state.avatarDisabled, "Expected the Agent avatar to be read-only before editing.");
            await ctx.expectText("身份");
            await ctx.expectText("运行方式");
            await ctx.expectText("模型与推理深度");
            await ctx.expectText("编辑");
          },
          screenshot: {
            name: "project-agent-inspector-view",
            requireText: ["身份", "运行方式", "模型与推理深度", "提示词", "应用与连接", "编辑"],
            rejectText: ["API Key:"],
          },
        });
      },
    },
    {
      name: "Edit the primary Agent",
      run: async (ctx) => {
        await ctx.prove("Edit mode reveals one unified Agent form without exposing credentials", {
          voiceover: "Edit reveals the shared form controls only when requested, keeping identity, runtime, prompt, skills, and applications in one compact order.",
          action: async () => {
            await ctx.eval('document.querySelector("[data-testid=project-agent-edit]").click(); true');
            await ctx.waitFor('Boolean(document.querySelector("#project-agent-name")) && Boolean(document.querySelector("[data-testid=project-agent-engine-select]"))', {
              label: "project Agent edit controls",
            });
            const avatarSeed = await ctx.eval('document.querySelector("[data-testid=project-agent-avatar]")?.getAttribute("data-avatar-seed")');
            await ctx.eval('document.querySelector("[data-testid=project-agent-avatar]").click(); true');
            await ctx.waitFor(`document.querySelector("[data-testid=project-agent-avatar]")?.getAttribute("data-avatar-seed") !== ${JSON.stringify(avatarSeed)}`, {
              label: "clickable generated Agent avatar",
            });
            const nextAvatarSeed = await ctx.eval('document.querySelector("[data-testid=project-agent-avatar]")?.getAttribute("data-avatar-seed")');
            ctx.assert(Boolean(avatarSeed) && avatarSeed !== nextAvatarSeed, "Expected clicking the avatar to generate another style.");
            const initialPluginCount = await ctx.eval('document.querySelectorAll("[data-testid=project-agent-plugin-row]").length');
            await ctx.eval(`(() => {
              const trigger = document.querySelector("[data-testid=project-agent-add-plugin]");
              trigger.scrollIntoView({ block: "center" });
              trigger.click();
              return true;
            })()`);
            await ctx.waitFor('Boolean(document.querySelector("input[placeholder=\\"搜索应用\\"]"))', {
              label: "searchable application picker",
            });
            await ctx.eval(`(() => {
              const popover = document.querySelector('[data-slot="popover-content"]');
              const items = popover ? [...popover.querySelectorAll('[data-slot="command-item"]')] : [];
              if (items.length < 2) throw new Error("Expected at least two available applications");
              const preferred = items.find((item) => item.textContent?.includes("DeepSeek Harness")) ?? items[0];
              preferred.click();
              return true;
            })()`);
            await ctx.waitFor('document.querySelector("[data-slot=popover-content]")?.innerText.includes("已选择 1 项") === true', {
              label: "first application selected without closing the picker",
            });
            await ctx.eval(`(() => {
              const popover = document.querySelector('[data-slot="popover-content"]');
              const item = popover && [...popover.querySelectorAll('[data-slot="command-item"]')].find((candidate) => candidate.getAttribute("data-checked") !== "true");
              if (!item) throw new Error("Second available application not found");
              item.click();
              return true;
            })()`);
            await ctx.waitFor('document.querySelector("[data-slot=popover-content]")?.innerText.includes("已选择 2 项") === true', {
              label: "two applications selected without closing the picker",
            });
            await ctx.eval(`(() => {
              const popover = document.querySelector('[data-slot="popover-content"]');
              const add = popover && [...popover.querySelectorAll('button')].find((button) => button.textContent?.trim() === "添加");
              if (!add) throw new Error("Application add button not found");
              add.click();
              return true;
            })()`);
            await ctx.waitFor(`document.querySelectorAll("[data-testid=project-agent-plugin-row]").length === ${initialPluginCount + 2}`, {
              label: "two applications added together",
            });
            await ctx.eval(`(() => {
              const trigger = document.querySelector("[data-testid=project-agent-add-skill]");
              trigger.scrollIntoView({ block: "center" });
              trigger.click();
              return true;
            })()`);
            await ctx.waitFor('Boolean(document.querySelector("input[placeholder=\\"搜索技能\\"]"))', {
              label: "searchable skill picker",
            });
            await ctx.waitFor('document.querySelector("[data-slot=popover-content]")?.innerText.includes("已选择 0 项") === true', {
              label: "skill picker uses the shared multi-select surface",
            });
            await ctx.eval('document.querySelector("[data-testid=project-agent-add-skill]").click(); true');
            await ctx.waitFor('!document.querySelector("input[placeholder=\\"搜索技能\\"]")', { label: "skill picker closed" });
            await ctx.eval('document.querySelector("[data-testid=project-agent-inspector-content]").scrollTo({ top: 0 }); true');
            await ctx.waitFor('document.querySelector("[data-testid=project-agent-inspector-content]").scrollTop === 0', {
              label: "Agent editor returned to identity fields",
            });
          },
          assert: async () => {
            await ctx.expectText("运行方式");
            await ctx.expectText("模型与推理深度");
            await ctx.expectText("提示词");
            await ctx.expectText("应用与连接");
            await ctx.expectText("添加应用");
            await ctx.expectText("添加技能");
            const addControls = await ctx.eval(`(() => ({
              plugin: Boolean(document.querySelector('[data-testid="project-agent-add-plugin"]')),
              skill: Boolean(document.querySelector('[data-testid="project-agent-add-skill"]')),
              primarySwitch: Boolean(document.querySelector('[data-testid="project-agent-inspector"] [data-slot="switch"]')),
            }))()`);
            ctx.assert(addControls.plugin && addControls.skill && addControls.primarySwitch, "Expected compact application, skill, and primary Agent controls.");
            await ctx.expectNoText("API Key:");
            await ctx.expectNoText("知识来源");
          },
          screenshot: {
            name: "project-agent-inspector",
            requireText: ["身份", "运行方式", "模型与推理深度", "提示词", "应用与连接", "添加应用", "添加技能"],
            rejectText: ["API Key:"],
          },
        });
      },
    },
    {
      name: "Open plugin authorization in place",
      run: async (ctx) => {
        await ctx.prove("Plugin authorization stays in the Agent inspector and reuses the Plugin Center dialog", {
          voiceover: "A missing application connection opens the same secure authorization dialog here, without sending the user away from the Agent they are configuring.",
          action: async () => {
            const beforeUrl = await ctx.eval("location.href");
            await ctx.eval(`(() => {
              const row = [...document.querySelectorAll('[data-testid="project-agent-plugin-row"]')]
                .find((candidate) => candidate.textContent?.includes("DeepSeek Harness"));
              const configure = row && [...row.querySelectorAll("button")]
                .find((button) => button.textContent?.trim() === "配置");
              if (!configure) throw new Error("DeepSeek authorization action not found");
              configure.click();
              return true;
            })()`);
            await ctx.waitFor(`[
              ...document.querySelectorAll('[role="dialog"]')
            ].some((dialog) => dialog.textContent?.includes("连接 DeepSeek"))`, {
              label: "shared plugin authorization dialog",
            });
            const state = await ctx.eval(`(() => ({
              url: location.href,
              inspector: Boolean(document.querySelector('[data-testid="project-agent-inspector"]')),
              pluginLibrary: Boolean(document.querySelector('[data-testid="plugin-library-heading"]')),
            }))()`);
            ctx.assert(state.url === beforeUrl, "Expected plugin authorization to keep the current project URL.");
            ctx.assert(state.inspector === true, "Expected the Agent inspector to remain open behind authorization.");
            ctx.assert(state.pluginLibrary === false, "Expected authorization not to navigate to Plugin Center.");
          },
          assert: async () => {
            await ctx.expectText("连接 DeepSeek");
            await ctx.expectText("DeepSeek API Key");
            await ctx.expectText("保存并连接");
          },
          screenshot: {
            name: "project-plugin-authorization-dialog",
            requireText: ["连接 DeepSeek", "DeepSeek API Key", "保存并连接"],
            rejectText: ["插件库"],
          },
        });
      },
    },
    {
      name: "Open the current project's board",
      run: async (ctx) => {
        await ctx.prove("The owning project shows the same item on its board", {
          voiceover: "Tasks stays a separate focused view, and it shows the exact same work item in its current stage.",
          action: async () => {
            await ctx.eval(`(() => {
              const authDialog = [...document.querySelectorAll('[role="dialog"]')]
                .find((dialog) => dialog.textContent?.includes("连接 DeepSeek"));
              const cancel = authDialog && [...authDialog.querySelectorAll("button")]
                .find((button) => button.textContent?.trim() === "取消");
              cancel?.click();
              return true;
            })()`);
            await ctx.waitFor(`![...document.querySelectorAll('[role="dialog"]')]
              .some((dialog) => dialog.textContent?.includes("连接 DeepSeek"))`, {
              label: "authorization dialog closed",
            });
            await ctx.eval(`(() => {
              const inspector = document.querySelector('[data-testid="project-agent-inspector"]');
              const cancel = inspector && [...inspector.querySelectorAll("button")]
                .find((button) => button.textContent?.trim() === "取消");
              if (!cancel) throw new Error("Agent edit cancel button not found");
              cancel.click();
              return true;
            })()`);
            await ctx.waitFor('Boolean(document.querySelector("[data-testid=project-agent-edit]")) && !document.querySelector("#project-agent-name")', {
              label: "Agent returned to view mode without saving",
            });
            await ctx.eval('document.querySelector(\'[data-slot="sheet-close"]\').click(); true');
            await ctx.waitFor('!document.querySelector("[data-testid=project-agent-inspector]")', {
              label: "Agent inspector closed",
            });
            await ctx.eval('document.querySelector("[data-testid=session-header-work-tasks]").click(); true');
            await ctx.waitFor(`!document.body.innerText.includes("Loading...") && document.body.innerText.includes(${JSON.stringify(ITEM_TITLE)})`, {
              label: "work item in project board",
            });
          },
          assert: async () => {
            await ctx.expectText("待规划");
            await ctx.expectText("进行中");
            await ctx.expectText(ITEM_TITLE);
          },
          screenshot: {
            name: "project-board",
            requireText: ["任务", "项目任务", "看板", "字段", "进行中", ITEM_TITLE],
          },
        });
      },
    },
    {
      name: "Inspect a runtime-owned task",
      run: async (ctx) => {
        await ctx.prove("A real project execution owns its task state and immutable runtime binding", {
          voiceover: "A task created by project execution is visibly bound to the Agent, engine, and model chosen on its first run. Its runtime-owned status and Agent cannot be silently edited.",
          action: async () => {
            await ctx.eval(`(() => {
              const card = [...document.querySelectorAll("article")]
                .find((candidate) => candidate.textContent?.includes(${JSON.stringify(EXECUTION_TITLE)}));
              const button = card?.querySelector("button");
              if (!button) throw new Error("Execution-bound task card not found");
              button.click();
              return true;
            })()`);
            await ctx.waitFor('Boolean(document.querySelector("[data-testid=work-item-execution-binding]"))', {
              label: "immutable execution binding",
            });
          },
          assert: async () => {
            await ctx.expectText("已固化执行配置");
            await ctx.expectText("此任务保留首次运行时的智能体、引擎和模型；项目配置变更只影响新任务。");
            const locked = await ctx.eval(`(() => ({
              status: document.querySelector("#work-item-status")?.disabled === true,
              assigneeHidden: document.querySelector("#work-item-assignee") === null,
              timingCollapsed: document.querySelector('[data-testid="work-item-sheet"] [data-slot="collapsible-trigger"]')?.getAttribute("aria-expanded") === "false",
            }))()`);
            ctx.assert(locked.status && locked.assigneeHidden, "Expected runtime-owned status to be locked without a redundant Agent input.");
            ctx.assert(locked.timingCollapsed, "Expected unused timing controls to stay collapsed.");
          },
          screenshot: {
            name: "project-execution-binding",
            requireText: [EXECUTION_TITLE, "已固化执行配置", "智能体", "引擎", "模型"],
          },
        });
      },
    },
    {
      name: "Inspect project-specific fields",
      run: async (ctx) => {
        await ctx.prove("Each project can shape its own lightweight fields", {
          voiceover: "Project Fields lets a template rename its stages and add only the metadata that this team needs.",
          action: async () => {
            await ctx.eval('document.querySelector(\'[data-slot="sheet-close"]\')?.click(); true');
            await ctx.waitFor('!document.querySelector("[data-testid=work-item-execution-binding]")', { label: "task inspector closed" });
            await ctx.eval(clickButtonExpression("字段"));
            await ctx.waitFor('document.body.innerText.includes("修改阶段名称，并定义这个项目需要的字段。")', {
              label: "project field configuration",
            });
          },
          assert: async () => {
            await ctx.expectText("项目阶段");
            await ctx.expectText("项目字段");
          },
          screenshot: {
            name: "project-fields",
            requireText: ["看板字段", "项目阶段", "项目字段"],
          },
        });
      },
    },
    {
      name: "Return to the conversation",
      run: async (ctx) => {
        await ctx.prove("The project navigation returns to the current conversation", {
          voiceover: "Conversation and Tasks remain two clear views of the same project, so the user can return without losing context.",
          action: async () => {
            await ctx.eval(`(() => {
              const dialog = [...document.querySelectorAll('[role="dialog"]')]
                .find((candidate) => candidate.textContent?.includes("看板字段"));
              const cancel = dialog && [...dialog.querySelectorAll("button")]
                .find((button) => button.textContent?.trim() === "取消");
              cancel?.click();
              return true;
            })()`);
            await ctx.waitFor('![...document.querySelectorAll(\'[role="dialog"]\')].some((dialog) => dialog.textContent?.includes("看板字段"))', { label: "project fields closed" });
            await ctx.eval('document.querySelector("[data-testid=session-header-work-conversation]").click(); true');
            await ctx.waitFor('document.querySelector("[data-testid=session-header-work-conversation]")?.getAttribute("aria-current") === "page" && !document.body.innerText.includes("项目任务")', {
              label: "conversation view",
            });
          },
          assert: async () => {
            await ctx.expectText("对话");
            await ctx.expectText("任务");
          },
          screenshot: {
            name: "project-conversation-navigation",
            requireText: ["对话", "任务"],
          },
        });
      },
    },
    {
      name: "Open the project builder entry",
      run: async (ctx) => {
        await ctx.prove("Project Builder stays in the current project's own menu", {
          voiceover: "The project menu adds one explicit Project Builder entry, keeping project design separate from ordinary global conversation.",
          action: async () => {
            const selector = `[data-testid="project-actions-menu"][data-project-id="${fixture.workspaceId}"]`;
            await ctx.eval(`(() => {
              const trigger = document.querySelector(${JSON.stringify(selector)});
              if (!trigger) throw new Error('Project actions menu was not found');
              trigger.closest('[data-sidebar="menu-item"]')?.scrollIntoView({ block: "center" });
              return true;
            })()`);
            await ctx.trustedClick(selector);
            await ctx.waitFor('Boolean(document.querySelector("[data-testid=project-builder-open]"))', {
              label: "project-scoped builder action",
            });
          },
          assert: async () => {
            await ctx.expectText("通过对话构建项目");
          },
          screenshot: {
            name: "project-builder-menu",
            requireText: ["通过对话构建项目"],
          },
        });
      },
    },
    {
      name: "Enter Project Builder",
      run: async (ctx) => {
        await ctx.prove("Only the explicitly created conversation enters Project Builder mode", {
          voiceover: "Entering Project Builder creates a clearly labeled project conversation and starts with a review-first prompt; project changes still wait for confirmation.",
          action: async () => {
            await ctx.eval('document.querySelector("[data-testid=project-builder-open]").click(); true');
            await ctx.waitFor('Boolean(document.querySelector("[data-testid=project-builder-badge]")) && document.body.innerText.includes("先读取当前项目")', {
              timeoutMs: 30_000,
              label: "scoped Project Builder conversation",
            });
            builderSessionId = await ctx.eval('location.hash.match(/\\/session\\/([^/?]+)/)?.[1] || null');
            ctx.assert(Boolean(builderSessionId), "Expected Project Builder to create a scoped conversation.");
          },
          assert: async () => {
            await ctx.expectText("项目构建");
            await ctx.expectText("先读取当前项目");
          },
          screenshot: {
            name: "project-builder-conversation",
            requireText: ["项目构建", "先读取当前项目"],
          },
        });
        await cleanupFixture(ctx);
      },
    },
  ],
};
