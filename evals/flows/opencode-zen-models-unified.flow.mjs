const ALL_ENGINES = [
  { project: "open", name: "open", label: "OpenCode", token: "OX_OPEN_OK_825" },
  { project: "codex", name: "codex", label: "Codex Harness", token: "OX_CODEX_OK_825" },
  { project: "dsh", name: "12312312", label: "DeepSeek Harness", token: "OX_DSH_OK_825" },
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
  "Ox Alpha Free",
];

const REMOVED_MODELS = [
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
    const ids = [...new Set([preferred, ...rows]
      .filter(Boolean)
      .map((row) => row.getAttribute('data-project-id'))
      .filter(Boolean))];
    for (const id of ids) {
      const row = document.querySelector('[data-testid="project-row"][data-project-id="' + id + '"]');
      row?.click();
      for (let attempt = 0; attempt < 720; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (document.querySelector(${JSON.stringify(`[aria-label^="${engine.label}"]`)})) return id;
      }
    }
    return null;
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
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(`[aria-label^="${engine.label}"]`)}))
    && Array.from(document.querySelectorAll("button"))
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
      .find((element) => element.getClientRects().length > 0 && element.innerText.includes("Ox Alpha Free"));
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

async function selectOxAndSend(ctx, engine) {
  const assistantBaseline = await ctx.eval(
    `document.querySelectorAll('[data-message-role="assistant"]').length`,
  );
  const selected = await ctx.eval(`(() => {
    const item = Array.from(document.querySelectorAll('[data-slot="command-item"]'))
      .find((candidate) => candidate.textContent?.includes("Ox Alpha Free")
        && !candidate.hasAttribute("data-disabled"));
    item?.click();
    return Boolean(item);
  })()`);
  ctx.assert(selected, `${engine.label} did not expose an enabled Ox Alpha Free row.`);
  await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
    .some((button) => /切换模型|Change model/.test(button.getAttribute("aria-label") ?? "")
      && button.textContent?.includes("Ox Alpha Free"))`, {
    timeoutMs: 30_000,
    label: `${engine.label} Ox selection`,
  });
  const prompt = `只回复 ${engine.token}，不要添加其他内容。`;
  const hasComposerTextAction = await ctx.eval(`window.__ipolloworkControl.listActions()
    .some((action) => action.id === "composer.set_text" && !action.disabled)`);
  if (hasComposerTextAction) {
    await ctx.control("composer.set_text", { text: prompt });
  } else {
    await ctx.eval(`(() => {
      const editor = document.querySelector('[contenteditable="true"][role="textbox"]');
      editor?.focus();
      return Boolean(editor);
    })()`);
    await ctx.client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await ctx.client.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await ctx.client.send("Input.insertText", { text: prompt });
  }
  await ctx.waitFor(`document.querySelector('[contenteditable="true"][role="textbox"]')
    ?.innerText.includes(${JSON.stringify(engine.token)})`, {
    timeoutMs: 30_000,
    label: `${engine.label} prompt text`,
  });
  const hasComposerSendAction = await ctx.eval(`window.__ipolloworkControl.listActions()
    .some((action) => action.id === "composer.send" && !action.disabled)`);
  if (hasComposerSendAction) {
    await ctx.control("composer.send");
  } else {
    const clicked = await ctx.eval(`(() => {
      const editor = document.querySelector('[contenteditable="true"][role="textbox"]');
      const shell = editor?.closest('[data-testid="new-conversation-starter-composer-shell"]');
      const button = Array.from(shell?.querySelectorAll("button") ?? [])
        .find((candidate) => /运行任务|Run task/i.test(candidate.getAttribute("title") ?? ""));
      button?.click();
      return Boolean(button);
    })()`);
    ctx.assert(clicked, `${engine.label} send button was unavailable.`);
  }
  await ctx.waitFor(`(() => {
    const messages = Array.from(document.querySelectorAll('[data-message-role="assistant"]'));
    return messages.length > ${assistantBaseline}
      && (messages.at(-1)?.innerText ?? "").includes(${JSON.stringify(engine.token)});
  })()`, {
    timeoutMs: 180_000,
    label: `${engine.label} Ox response`,
  });
}

export default {
  id: "opencode-zen-models-unified",
  title: "OpenCode Zen exposes one curated free-model list across every agent engine",
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
      await ctx.prove(`${engine.label} shows the same six supported OpenCode Zen models`, {
        voiceover: `在 ${engine.label} 的模型列表里，OpenCode Zen 都包含同一组六个模型，其中包括 Ox Alpha Free。`,
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
      await ctx.prove(`${engine.label} can send a real message with Ox Alpha Free`, {
        voiceover: `在 ${engine.label} 中选中 Ox Alpha Free 后，消息成功发出并返回唯一校验词。`,
        action: async () => {
          await selectOxAndSend(ctx, engine);
        },
        assert: async () => {
          await ctx.expectText(engine.token);
          await ctx.expectNoText("Endpoint is unavailable");
          await ctx.expectNoText("ProviderModelNotFoundError");
        },
        screenshot: {
          name: `${engine.project}-ox-alpha-response`,
          fromSurface: true,
          requireText: [engine.token, "Ox Alpha Free", engine.label],
          rejectText: ["Endpoint is unavailable", "ProviderModelNotFoundError"],
        },
      });
    },
  })),
};
