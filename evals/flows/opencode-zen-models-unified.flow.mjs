const ALL_ENGINES = [
  { project: "open", name: "open", label: "OpenCode" },
  { project: "codex", name: "codex", label: "Codex Harness" },
  { project: "dsh", name: "12312312", label: "DeepSeek Harness" },
];
const ENGINE_FILTER = process.env.IPOLLOWORK_FRAIMZ_ENGINE?.trim().toLowerCase();
const ENGINES = ENGINE_FILTER
  ? ALL_ENGINES.filter((engine) => engine.project === ENGINE_FILTER)
  : ALL_ENGINES;

const EXPECTED_MODELS = [
  "Big Pickle",
  "Hy3 Free",
  "MiMo-V2.5 Free",
  "Nemotron 3 Ultra Free",
  "Nemotron 3.5 Lightning Free",
];

const REMOVED_MODELS = [
  "Ox Alpha Free",
  "DeepSeek V4 Flash Free",
  "Laguna S 2.1 Free",
  "Ling-3.0-flash Free",
  "Muse Spark 1.2 Contributor Free",
  "North Mini Code Free",
];

const DEEPSEEK_PROJECT = {
  folderPath: "C:\\Users\\31939\\AppData\\Roaming\\com.differentai.ipollowork.dev\\ipollowork-dev-data\\home\\.ipollowork\\projects\\d23f4c3aed81f5c60f2bbaca",
  name: "12312312",
  preset: "starter",
  engineId: "deepseek-harness",
};

async function ensureDeepSeekProjectRegistered(ctx) {
  const serializedResult = await ctx.eval(`(async () => {
    try {
      if (!window.__IPOLLOWORK_ELECTRON__?.invokeDesktop) {
        return "ERR:desktop bridge unavailable";
      }
      const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop("ipolloworkServerInfo");
      const tokens = [info?.hostToken, info?.ownerToken, info?.clientToken].filter(Boolean);
      if (!info?.baseUrl || tokens.length === 0) {
        return "ERR:embedded server credentials unavailable";
      }
      let lastFailure = "";
      for (const token of tokens) {
        const response = await fetch(info.baseUrl + "/workspaces/local", {
          method: "POST",
          headers: {
            authorization: "Bearer " + token,
            "content-type": "application/json",
          },
          body: JSON.stringify(${JSON.stringify(DEEPSEEK_PROJECT)}),
        });
        if (response.ok) return "OK:" + response.status;
        lastFailure = response.status + ":" + await response.text();
      }
      return "ERR:" + lastFailure;
    } catch (error) {
      return "ERR:" + (error instanceof Error ? error.message : String(error));
    }
  })()`, { awaitPromise: true });
  ctx.assert(
    typeof serializedResult === "string" && serializedResult.startsWith("OK:"),
    `Could not register the existing DeepSeek Harness project: ${String(serializedResult)}`,
  );
  const timeOrigin = await ctx.eval("performance.timeOrigin");
  await ctx.eval("location.reload(); true");
  await ctx.waitFor(`performance.timeOrigin !== ${JSON.stringify(timeOrigin)}`, {
    timeoutMs: 60_000,
    label: "new document after DeepSeek project registration",
  });
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
    timeoutMs: 60_000,
    label: "app reload after DeepSeek project registration",
  });
}

async function openEngineModelDirectory(ctx, engine) {
  await ctx.eval(`(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const back = Array.from(document.querySelectorAll("button, a"))
      .find((element) => element.textContent?.trim() === "返回应用");
    back?.click();
    return Boolean(back);
  })()`, { awaitPromise: true });
  await ctx.waitFor(`Array.from(document.querySelectorAll('[data-testid="project-row"][data-project-id]'))
    .some((row) => row.textContent?.trim().toLowerCase() === ${JSON.stringify(engine.name)})`, {
    timeoutMs: 60_000,
    label: `${engine.label} project row`,
  });
  const selectedProjectId = await ctx.eval(`(async () => {
    const rows = Array.from(document.querySelectorAll('[data-testid="project-row"][data-project-id]'));
    const preferred = rows.find((row) =>
      row.textContent?.trim().toLowerCase() === ${JSON.stringify(engine.name)});
    const id = preferred?.getAttribute('data-project-id') ?? null;
    preferred?.click();
    return id;
  })()`, { awaitPromise: true });
  ctx.assert(Boolean(selectedProjectId), `Could not find a ${engine.label} project.`);
  const previousRoute = await ctx.eval("location.hash");
  if (!previousRoute.endsWith("/session")) {
    const openedFreshTask = await ctx.eval(`(() => {
      const button = document.querySelector(
        '[data-testid="project-new-conversation-button"][data-project-id="${selectedProjectId}"]',
      );
      button?.click();
      return Boolean(button);
    })()`);
    ctx.assert(openedFreshTask, `Could not open a fresh ${engine.label} task.`);
    await ctx.waitFor(`location.hash !== ${JSON.stringify(previousRoute)}`, {
      timeoutMs: 30_000,
      label: `${engine.label} fresh task route`,
    });
  }
  await ctx.eval("new Promise((resolve) => setTimeout(resolve, 1200))", { awaitPromise: true });
  await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
      .some((button) => /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""))`, {
    timeoutMs: 30_000,
    label: `${engine.label} composer`,
  });
  await ctx.eval(`(() => {
    const trigger = Array.from(document.querySelectorAll("button"))
      .find((button) => /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""));
    trigger?.click();
    return Boolean(trigger);
  })()`);
  await ctx.waitForText("切换模型", { timeoutMs: 10_000 });
  await ctx.eval(`(() => {
    const candidates = Array.from(document.querySelectorAll("button"))
      .filter((button) => button.textContent?.includes("切换模型")
        && !/切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""));
    candidates.at(-1)?.click();
    return candidates.length > 0;
  })()`);
  await ctx.waitFor(`Array.from(document.querySelectorAll('[role="dialog"][data-slot="popover-content"]'))
    .some((element) => element.getClientRects().length > 0
      && element.innerText.includes("切换模型")
      && element.innerText.includes("Nemotron 3.5 Lightning Free"))`, {
    timeoutMs: 90_000,
    label: `${engine.label} OpenCode Zen model directory`,
  });
  await ctx.fill(
    '[role="dialog"][data-slot="popover-content"] input[placeholder="搜索模型..."]',
    "OpenCode Zen",
    { timeoutMs: 30_000 },
  );
  await ctx.waitFor(`(() => {
    const dialog = Array.from(document.querySelectorAll('[role="dialog"][data-slot="popover-content"]'))
      .find((element) => element.getClientRects().length > 0 && element.innerText.includes("Big Pickle"));
    return dialog && ${JSON.stringify(EXPECTED_MODELS)}.every((model) => dialog.innerText.includes(model));
  })()`, {
    timeoutMs: 30_000,
    label: `${engine.label} filtered OpenCode Zen models`,
  });
}

async function assertUnifiedModels(ctx, engine) {
  const state = await ctx.eval(`(() => {
    const directories = Array.from(document.querySelectorAll('[role="dialog"][data-slot="popover-content"]'))
      .filter((element) => element.getClientRects().length > 0 && element.innerText.includes("切换模型"));
    const text = directories.at(-1)?.innerText ?? "";
    return { text };
  })()`);
  for (const model of EXPECTED_MODELS) {
    ctx.assert(state.text.includes(model), `${engine.label} is missing ${model}.`);
  }
  for (const model of REMOVED_MODELS) {
    ctx.assert(!state.text.includes(model), `${engine.label} still shows removed model ${model}.`);
  }
}

export default {
  id: "opencode-zen-models-unified",
  title: "OpenCode Zen exposes one agent-compatible free-model list across every engine",
  kind: "user-facing",
  steps: ENGINES.map((engine) => ({
    name: `${engine.label} uses the unified OpenCode Zen directory`,
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
        timeoutMs: 30_000,
        label: "window.__ipolloworkControl",
      });
      if (engine.label === "DeepSeek Harness") {
        await ensureDeepSeekProjectRegistered(ctx);
      }
      await ctx.prove(`${engine.label} shows only the five runnable OpenCode Zen agent models`, {
        voiceover: `在 ${engine.label} 的模型列表里，只显示五个当前可以执行 Agent 任务的 OpenCode Zen 模型，已被上游拒绝的 Ox Alpha 不再伪装成可用。`,
        action: async () => {
          await openEngineModelDirectory(ctx, engine);
        },
        assert: async () => {
          await assertUnifiedModels(ctx, engine);
        },
        screenshot: {
          name: `${engine.project}-unified-opencode-zen-models`,
          requireText: ["切换模型", ...EXPECTED_MODELS],
          rejectText: REMOVED_MODELS,
        },
      });
    },
  })),
};
