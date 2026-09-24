const ALL_ENGINES = [
  { project: "open", engineId: "opencode", name: "免费模型 OpenCode 验证", label: "OpenCode" },
  { project: "codex", engineId: "codex-harness", name: "免费模型 Codex 验证", label: "Codex Harness" },
  { project: "dsh", engineId: "deepseek-harness", name: "免费模型 DSH 验证", label: "DeepSeek Harness" },
];
const ENGINE_FILTER = process.env.IPOLLOWORK_FRAIMZ_ENGINE?.trim().toLowerCase();
const ENGINES = ENGINE_FILTER
  ? ALL_ENGINES.filter((engine) => engine.project === ENGINE_FILTER)
  : ALL_ENGINES;

const EXPECTED_MODELS = [
  "Big Pickle",
  "MiMo-V2.5 Free",
  "Nemotron 3 Ultra Free",
  "Nemotron 3.5 Lightning Free",
];

const REMOVED_MODELS = [
  "Hy3 Free",
  "Ox Alpha Free",
  "DeepSeek V4 Flash Free",
  "Laguna S 2.1 Free",
  "Ling-3.0-flash Free",
  "Muse Spark 1.2 Contributor Free",
  "North Mini Code Free",
];

const INVOCATION_MODEL = "MiMo-V2.5 Free";
const RATE_LIMIT_TEXTS = [
  "模型当前请求较多",
  "当前模型请求过于频繁",
  "第三方服务请求过于频繁",
  "第三方服务余额或额度不足",
  "This model is receiving too many requests",
];
const BLOCKED_TEXTS = [
  "模型登录凭证已过期",
  "The model sign-in expired",
  "requires an API key",
  "需要 API Key",
  "only be used from within OpenCode",
  "当前账号无权使用该第三方服务或模型",
];

async function api(ctx, path) {
  return ctx.eval(`(async () => {
    const baseUrl = localStorage.getItem('ipollowork.server.urlOverride');
    const token = localStorage.getItem('ipollowork.server.token');
    const response = await fetch(baseUrl + ${JSON.stringify(path)}, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  })()`, { awaitPromise: true });
}

async function workspaces(ctx) {
  const response = await api(ctx, "/workspaces");
  ctx.assert(response.status === 200, `Could not list projects: ${JSON.stringify(response)}`);
  return response.body.items ?? response.body.workspaces ?? [];
}

export async function ensureEngineWorkspace(ctx, engine) {
  const existing = (await workspaces(ctx)).find((workspace) => workspace.engineId === engine.engineId);
  if (existing) return existing;

  await ctx.eval(`document.querySelector('[data-testid="new-project-button"]')?.click()`);
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=create-project-dialog]'))", {
    timeoutMs: 15_000,
    label: "create project dialog",
  });
  await ctx.fill("#create-project-name", engine.name);
  const selected = await ctx.eval(`(() => {
    const option = document.querySelector('[data-testid="project-engine-option"][data-engine-id="${engine.engineId}"] input');
    option?.click();
    return Boolean(option);
  })()`);
  ctx.assert(selected, `Could not select ${engine.label} while creating a project.`);
  const created = await ctx.eval(`(() => {
    const dialog = document.querySelector('[data-testid=create-project-dialog]');
    const button = [...(dialog?.querySelectorAll('button') ?? [])]
      .find((entry) => ['创建', 'Create'].includes(entry.textContent?.trim() ?? ''));
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(created, `Could not create the ${engine.label} project.`);
  await ctx.waitFor("!document.querySelector('[data-testid=create-project-dialog]')", {
    timeoutMs: 60_000,
    label: `${engine.label} project created`,
  });
  const workspace = (await workspaces(ctx)).find((entry) => entry.engineId === engine.engineId);
  ctx.assert(workspace, `The created ${engine.label} project was not persisted.`);
  return workspace;
}

async function openEngineModelDirectory(ctx, engine) {
  await ctx.eval(`(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    return true;
  })()`, { awaitPromise: true });
  const workspace = await ensureEngineWorkspace(ctx, engine);
  await ctx.navigateHash(`/workspace/${workspace.id}/session`);
  await ctx.waitFor(`location.hash.includes(${JSON.stringify(`/workspace/${workspace.id}/session`)})`, {
    timeoutMs: 30_000,
    label: `${engine.label} workspace route`,
  });
  await ctx.eval("new Promise((resolve) => setTimeout(resolve, 1200))", { awaitPromise: true });
  await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
      .some((button) => /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""))`, {
    timeoutMs: 30_000,
    label: `${engine.label} composer`,
  });
  await ctx.eval(`Array.from(document.querySelectorAll('button'))
    .find((button) => /切换模型|Change model/.test(button.getAttribute('aria-label') ?? ''))?.click()`);
  await ctx.clickText("切换模型", { selector: '[role="dialog"][data-slot="popover-content"] button' });
  await ctx.waitFor(`Array.from(document.querySelectorAll('[role="dialog"][data-slot="popover-content"]'))
    .some((element) => element.getClientRects().length > 0
      && element.innerText.includes("切换模型"))`, {
    timeoutMs: 90_000,
    label: `${engine.label} model directory`,
  });
  await ctx.fill(
    '[role="dialog"][data-slot="popover-content"] input[placeholder="搜索模型..."]',
    "OpenCode Zen",
    { timeoutMs: 30_000 },
  );
  if (engine.engineId === "opencode") {
    await ctx.waitFor(`(() => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"][data-slot="popover-content"]'))
        .find((element) => element.getClientRects().length > 0 && element.innerText.includes("Big Pickle"));
      return dialog && ${JSON.stringify(EXPECTED_MODELS)}.every((model) => dialog.innerText.includes(model));
    })()`, { timeoutMs: 30_000, label: `${engine.label} filtered OpenCode Zen models` });
  }
}

async function assertUnifiedModels(ctx, engine) {
  const state = await ctx.eval(`(() => {
    const directories = Array.from(document.querySelectorAll('[role="dialog"][data-slot="popover-content"]'))
      .filter((element) => element.getClientRects().length > 0 && element.innerText.includes("切换模型"));
    const text = directories.at(-1)?.innerText ?? "";
    return { text };
  })()`);
  for (const model of EXPECTED_MODELS) {
    ctx.assert(engine.engineId === "opencode" ? state.text.includes(model) : !state.text.includes(model),
      `${engine.label} has incorrect visibility for ${model}.`);
  }
  for (const model of REMOVED_MODELS) {
    ctx.assert(!state.text.includes(model), `${engine.label} still shows removed model ${model}.`);
  }
}

export async function selectAndInvokeFreeModel(ctx, engine, request = {}) {
  const selected = await ctx.eval(`(() => {
    const current = Array.from(document.querySelectorAll('button')).find((button) =>
      /切换模型|Change model/.test(button.getAttribute('aria-label') ?? '')
      && button.textContent?.includes(${JSON.stringify(INVOCATION_MODEL)}));
    const item = Array.from(document.querySelectorAll('[data-slot="command-item"]'))
      .find((entry) => entry.textContent?.includes(${JSON.stringify(INVOCATION_MODEL)})
        && !entry.hasAttribute('data-disabled'));
    item?.click();
    return Boolean(item || current);
  })()`);
  ctx.assert(selected, `${engine.label} could not select ${INVOCATION_MODEL}.`);
  await ctx.waitFor(`Array.from(document.querySelectorAll('button'))
    .some((button) => /切换模型|Change model/.test(button.getAttribute('aria-label') ?? '')
      && button.textContent?.includes(${JSON.stringify(INVOCATION_MODEL)}))`, {
    timeoutMs: 30_000,
    label: `${engine.label} selected ${INVOCATION_MODEL}`,
  });

  const token = request.token ?? `FREE_${engine.project.toUpperCase()}_OK_922`;
  await ctx.waitFor("Boolean(document.querySelector('[contenteditable=\"true\"]'))", {
    timeoutMs: 30_000,
    label: `${engine.label} composer ready`,
  });
  const pasted = await ctx.eval(`(() => {
    const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
      || document.querySelector('[contenteditable="true"]');
    if (!editor) return false;
    editor.focus();
    const data = new DataTransfer();
    data.setData('text/plain', ${JSON.stringify(request.prompt ?? `只回复 ${token}`)});
    editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    return true;
  })()`);
  ctx.assert(pasted, `${engine.label} composer did not accept the free-model prompt.`);
  await ctx.waitFor(`Array.from(document.querySelectorAll('[contenteditable="true"]'))
    .some((editor) => editor.textContent?.includes(${JSON.stringify(token)}))`, {
    timeoutMs: 15_000, label: `${engine.label} authored prompt remains in the composer`,
  });
  await ctx.waitFor(`Array.from(document.querySelectorAll('button'))
    .some((button) => /运行任务|Run task|Send/i.test(button.getAttribute('title') ?? button.textContent ?? '')
      && !button.disabled)
    || Array.from(document.querySelectorAll('button'))
      .some((button) => button.querySelector('svg[class*="arrow-up"]') && !button.disabled)`, {
    timeoutMs: 15_000,
    label: `${engine.label} send enabled`,
  });
  const submitted = await ctx.eval(`(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find((entry) => /运行任务|Run task|Send/i.test(entry.getAttribute('title') ?? entry.textContent ?? '')
        && !entry.disabled)
      || Array.from(document.querySelectorAll('button'))
        .find((entry) => entry.querySelector('svg[class*="arrow-up"]') && !entry.disabled);
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(submitted, `${engine.label} could not submit the free-model prompt.`);
  await ctx.waitFor(`document.querySelector('[data-chat-transcript]')?.textContent?.includes(${JSON.stringify(token)})`, {
    timeoutMs: 70_000, label: `${engine.label} user message was persisted`,
  });
  await ctx.waitFor(`(() => {
    const transcript = document.querySelector('[data-chat-transcript]');
    const text = transcript?.textContent ?? '';
    const replied = Array.from(transcript?.querySelectorAll('[data-message-role="assistant"]') ?? [])
      .some((message) => message.textContent?.includes(${JSON.stringify(token)}));
    const stop = window.__ipolloworkControl.listActions().find((action) => action.id === 'composer.stop');
    const idle = !stop || stop.disabled;
    return idle && (replied
      || ${JSON.stringify(RATE_LIMIT_TEXTS)}.some((value) => text.includes(value))
      || ${JSON.stringify(BLOCKED_TEXTS)}.some((value) => text.includes(value)));
  })()`, {
    timeoutMs: 120_000,
    label: `${engine.label} free-model response or upstream quota`,
  });
  await ctx.eval(`(() => {
    const transcript = document.querySelector('[data-chat-transcript]');
    const text = transcript?.textContent ?? '';
    const details = Array.from(transcript?.querySelectorAll('summary,button') ?? [])
      .find((button) => /查看技术详情|View technical details/.test(button.textContent ?? ''));
    details?.click();
    return true;
  })()`);
  return token;
}

export async function assertFreeModelInvocation(ctx, engine, token) {
  const state = await ctx.eval(`(() => {
    const text = document.querySelector('[data-chat-transcript]')?.textContent ?? '';
    return {
      text,
      replied: Array.from(document.querySelectorAll('[data-chat-transcript] [data-message-role="assistant"]'))
        .some((message) => message.textContent?.includes(${JSON.stringify(token)})),
      rateLimited: ${JSON.stringify(RATE_LIMIT_TEXTS)}.some((value) => text.includes(value)),
      blocked: ${JSON.stringify(BLOCKED_TEXTS)}.filter((value) => text.includes(value)),
    };
  })()`);
  ctx.assert(
    state.replied && !state.rateLimited,
    `${engine.label} did not return a real free-model reply (quota is not success): ${JSON.stringify(state)}`,
  );
  ctx.assert(state.blocked.length === 0, `${engine.label} was blocked before free-model inference: ${state.blocked.join(", ")}`);
}

export default {
  id: "opencode-zen-models-unified",
  title: "OpenCode free models appear only in the OpenCode engine",
  kind: "user-facing",
  steps: ENGINES.map((engine) => ({
    name: `${engine.label} respects engine-specific free-model visibility`,
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
        timeoutMs: 30_000,
        label: "window.__ipolloworkControl",
      });
      await ctx.prove(`${engine.label} ${engine.engineId === "opencode" ? "shows" : "hides"} OpenCode free models`, {
        voiceover: engine.engineId === "opencode"
          ? "OpenCode 项目保留免费模型选项，可在自己的引擎里选择。"
          : `${engine.label} 项目不再显示仅供 OpenCode 引擎使用的免费模型。`,
        action: async () => {
          await openEngineModelDirectory(ctx, engine);
        },
        assert: async () => {
          await assertUnifiedModels(ctx, engine);
        },
        screenshot: {
          name: `${engine.project}-opencode-free-model-visibility`,
          requireText: engine.engineId === "opencode" ? ["切换模型", ...EXPECTED_MODELS] : ["切换模型"],
          rejectText: engine.engineId === "opencode" ? REMOVED_MODELS : EXPECTED_MODELS,
          },
        });
    },
  })),
};
