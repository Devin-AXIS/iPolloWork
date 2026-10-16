const engines = [
  { id: "deepseek-harness", label: "DSH", name: "三引擎并发验证 DSH" },
  { id: "codex-harness", label: "Codex", name: "三引擎并发验证 Codex" },
  { id: "opencode", label: "OpenCode", name: "三引擎并发验证 OpenCode" },
];

async function readApi(ctx, path) {
  return ctx.eval(`(async () => {
    const base = localStorage.getItem('ipollowork.server.urlOverride');
    const token = localStorage.getItem('ipollowork.server.token');
    const response = await fetch(base + ${JSON.stringify(path)}, {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, body: await response.json() };
  })()`, { awaitPromise: true });
}

async function openProject(ctx, engine) {
  const context = await ctx.eval("localStorage.getItem('ipollowork.work-context.v1') || 'personal'");
  const existing = await readApi(ctx, "/workspaces");
  const found = existing.body.items.find((item) => item.name === engine.name
    && item.engineId === engine.id && (item.workContextId || "personal") === context);
  if (found) return found;

  await ctx.eval(`document.querySelector('[data-testid="new-project-button"]')?.click()`);
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=create-project-dialog]'))", { timeoutMs: 15_000 });
  await ctx.fill("#create-project-name", engine.name);
  ctx.assert(await ctx.eval(`(() => {
    const input = document.querySelector('[data-testid="project-engine-option"][data-engine-id="${engine.id}"] input');
    input?.click(); return Boolean(input);
  })()`), `Could not select ${engine.label} project engine`);
  ctx.assert(await ctx.eval(`(() => {
    const dialog = document.querySelector('[data-testid=create-project-dialog]');
    const button = [...(dialog?.querySelectorAll('button') ?? [])]
      .find((item) => /^(创建|新建项目|Create|Create project)$/.test(item.textContent?.trim() ?? '') && !item.disabled);
    button?.click(); return Boolean(button);
  })()`), `Could not submit ${engine.label} project creation`);
  await ctx.waitFor("!document.querySelector('[data-testid=create-project-dialog]')", { timeoutMs: 60_000 });
  const saved = await readApi(ctx, "/workspaces");
  const project = saved.body.items.find((item) => item.name === engine.name
    && item.engineId === engine.id && (item.workContextId || "personal") === context);
  ctx.assert(project, `${engine.label} project was not persisted`);
  return project;
}

async function navigateToNewTask(ctx, project) {
  await ctx.navigateHash(`/workspace/${project.id}/session`);
  await ctx.waitFor(`(() => {
    const route = window.__ipollowork?.snapshot().route;
    return route?.selectedWorkspaceId === ${JSON.stringify(project.id)}
      && !route.selectedSessionId && !route.loading
      && Boolean(document.querySelector('[contenteditable="true"]'));
  })()`, { timeoutMs: 45_000, label: `${project.name} new task is ready` });
  // The route shell mounts before the engine-specific composer finishes
  // replacing the previous one. Give that commit one short settle window.
  await new Promise((resolve) => setTimeout(resolve, 800));
}

async function selectGpt55(ctx, engine) {
  const selected = `Array.from(document.querySelectorAll('button')).some((button) =>
    /切换模型|Change model/.test(button.getAttribute('aria-label') ?? '')
    && button.textContent?.includes('GPT-5.5') && !button.textContent?.includes('Fast'))`;
  if (engine.id === "opencode" && await ctx.eval(selected)) return;
  await ctx.eval(`Array.from(document.querySelectorAll('button'))
    .find((button) => /切换模型|Change model/.test(button.getAttribute('aria-label') ?? ''))?.click()`);
  await ctx.waitFor("Array.from(document.querySelectorAll('[role=dialog] button')).some((button) => /切换模型|Change model/.test(button.textContent ?? ''))", { timeoutMs: 15_000 });
  await ctx.eval(`Array.from(document.querySelectorAll('[role=dialog] button'))
    .find((button) => /切换模型|Change model/.test(button.textContent ?? ''))?.click()`);
  await ctx.waitFor(`Array.from(document.querySelectorAll('[data-slot="command-item"]'))
    .some((item) => /GPT-5\\.5(?! Fast)/.test(item.textContent ?? ''))`, { timeoutMs: 45_000 });
  if (engine.id !== "opencode") {
    const freeVisible = await ctx.eval(`Array.from(document.querySelectorAll('[data-slot="command-item"]'))
      .some((item) => /MiMo-V2\\.5 Free|Big Pickle|Nemotron 3 Ultra Free/.test(item.textContent ?? ''))`);
    ctx.assert(freeVisible, `${engine.label} does not expose OpenCode free models`);
  }
  ctx.assert(await ctx.eval(`(() => {
    const item = Array.from(document.querySelectorAll('[data-slot="command-item"]'))
      .find((entry) => /GPT-5\\.5(?! Fast)/.test(entry.textContent ?? '') && !entry.hasAttribute('data-disabled'));
    item?.click(); return Boolean(item);
  })()`), `${engine.label} could not select GPT-5.5`);
  await ctx.waitFor(selected, { timeoutMs: 15_000, label: `${engine.label} GPT-5.5 selected` });
}

async function dispatchTask(ctx, project, engine, token) {
  await navigateToNewTask(ctx, project);
  await selectGpt55(ctx, engine);
  const text = `只回复 ${token}，不要调用工具。`;
  let ready = false;
  for (let attempt = 0; attempt < 4 && !ready; attempt += 1) {
    const hasText = await ctx.eval(`document.querySelector('[contenteditable="true"]')?.textContent?.includes(${JSON.stringify(token)})`);
    if (!hasText) {
      await ctx.eval(`(() => {
        const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
        editor?.focus(); return Boolean(editor);
      })()`);
      await ctx.client.send("Input.insertText", { text });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    ready = await ctx.eval(`(() => {
      const button = document.querySelector('button[title="运行任务"],button[title="Run task"]');
      const editor = document.querySelector('[contenteditable="true"]');
      return editor?.textContent?.includes(${JSON.stringify(token)}) && button && !button.disabled;
    })()`);
  }
  ctx.assert(ready, `${engine.label} task composer did not become ready`);
  ctx.assert(await ctx.eval(`(() => {
    const button = document.querySelector('button[title="运行任务"],button[title="Run task"]');
    button?.click(); return Boolean(button);
  })()`), `${engine.label} could not send task`);
  await ctx.waitFor(`(() => {
    const route = window.__ipollowork?.snapshot().route;
    return route?.selectedWorkspaceId === ${JSON.stringify(project.id)} && Boolean(route.selectedSessionId);
  })()`, { timeoutMs: 120_000, label: `${engine.label} created a task without timeout` });
  const sessionId = await ctx.eval("window.__ipollowork.snapshot().route.selectedSessionId");
  const deadline = Date.now() + 60_000;
  let accepted = false;
  do {
    const read = await readApi(ctx, `/workspace/${project.id}/sessions/${sessionId}/snapshot`);
    accepted = read.status === 200 && (read.body.item?.messages ?? []).some((message) =>
      message.info.role === "user" && message.parts.some((part) => part.type === "text" && part.text?.includes(token)));
    if (accepted) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  ctx.assert(accepted, `${engine.label} did not persist the user request`);
  return { projectId: project.id, sessionId, token, engineId: engine.id };
}

export default {
  id: "three-engine-gpt55",
  title: "Three project engines rapidly create and finish GPT-5.5 tasks",
  kind: "user-facing",
  steps: [{
    name: "Create DSH, Codex and OpenCode projects and finish GPT-5.5 tasks",
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000 });
      const runTag = process.env.IPOLLOWORK_EVAL_REUSE_TAG
        || new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
      const runEngines = engines.map((engine) => ({ ...engine, name: `${engine.name} ${runTag}` }));
      const projects = [];
      let tasks = [];
      await ctx.prove("Three projects each deliver a real GPT-5.5 reply without a task error or timeout", {
        voiceover: "快速建立 DSH、Codex 和 OpenCode 三个项目，分别选 GPT-5.5 发送任务，然后核对每个项目的实际回复。",
        action: async () => {
          for (const engine of runEngines) projects.push(await openProject(ctx, engine));
          for (let i = 0; i < runEngines.length; i += 1) {
            const engine = runEngines[i];
            tasks.push(await dispatchTask(ctx, projects[i], engine, `TRI_${engine.label.toUpperCase()}_55`));
          }
        },
        assert: async () => {
          const deadline = Date.now() + 180_000;
          let results;
          do {
            results = await Promise.all(tasks.map(async (task) => {
              const read = await readApi(ctx, `/workspace/${task.projectId}/sessions/${task.sessionId}/snapshot`);
              const snapshot = read.body.item;
              return { ...task, status: snapshot?.status?.type,
                replied: (snapshot?.messages ?? []).some((message) => message.info.role === "assistant"
                  && message.parts.some((part) => part.type === "text" && part.text?.includes(task.token))),
                error: (snapshot?.messages ?? []).some((message) => message.info.error),
              };
            }));
            if (results.every((item) => item.error || (item.replied && item.status === "idle"))) break;
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } while (Date.now() < deadline);
          ctx.assert(results.every((item) => item.replied && !item.error), JSON.stringify(results));
          ctx.assert(new Set(results.map((item) => item.sessionId)).size === 3, "Tasks must be isolated");
          ctx.output("three-engine-results", JSON.stringify(results, null, 2));
        },
        screenshot: { name: "three-gpt55-projects", requireText: ["GPT-5.5", "TRI_OPENCODE_55"] },
      });
    },
  }],
};
