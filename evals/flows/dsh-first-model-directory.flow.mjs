const MODEL_LABEL = "DeepSeek-V4-Flash";
const MODEL_DISPLAY_LABEL = "Deepseek V4 Flash";

async function workspaceIds(ctx) {
  return await ctx.eval(`(async () => {
    const port = localStorage.getItem("ipollowork.server.port");
    const token = localStorage.getItem("ipollowork.server.token");
    if (!port || !token) return { error: "missing local server connection" };
    const response = await fetch("http://127.0.0.1:" + port + "/workspaces", {
      headers: { Authorization: "Bearer " + token },
    });
    const payload = await response.json();
    const workspaces = Array.isArray(payload) ? payload : payload.workspaces ?? [];
    return {
      dsh: workspaces.find((workspace) => workspace.engineId === "deepseek-harness")?.id,
    };
  })()`, { awaitPromise: true });
}

async function openModelDirectory(ctx) {
  const trigger = `Array.from(document.querySelectorAll("button"))
    .find((button) => button.getClientRects().length > 0
      && !button.disabled
      && /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""))`;
  await ctx.waitFor(`Boolean(${trigger})`, { timeoutMs: 60_000, label: "DSH model trigger" });
  await ctx.eval(`(${trigger})?.click()`);
  await ctx.waitForText("切换模型", { timeoutMs: 10_000 });
  const opened = await ctx.eval(`(() => {
    const entry = Array.from(document.querySelectorAll("button"))
      .filter((button) => button.getClientRects().length > 0
        && button.textContent?.includes("切换模型")
        && !/切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""))
      .at(-1);
    entry?.click();
    return Boolean(entry);
  })()`);
  ctx.assert(opened, "Could not open the model directory from the behavior menu.");
}

export default {
  id: "dsh-first-model-directory",
  title: "DSH first model directory hydrates without visiting Settings",
  kind: "user-facing",
  steps: [{
    name: "Open configured models directly from the first DSH session",
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
        timeoutMs: 60_000,
        label: "iPolloWork control API",
      });
      const ids = await workspaceIds(ctx);
      ctx.assert(!ids.error && Boolean(ids.dsh), ids.error ?? "A DSH workspace is required.");

      await ctx.eval(`(() => {
        localStorage.setItem("ipollowork.react.activeWorkspace", ${JSON.stringify(ids.dsh)});
        location.reload();
        return true;
      })()`);
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
        timeoutMs: 60_000,
        label: "reloaded iPolloWork control API",
      });

      await ctx.prove("Selecting a model in the first DSH session immediately updates the composer to that same model", {
        voiceover: "选择 Flash 后，输入框立即显示同一个模型，不再被后台校验替换成 PRO。",
        action: async () => {
          await ctx.navigateHash(`/workspace/${ids.dsh}/session`);
          await openModelDirectory(ctx);
          await ctx.waitFor(`Array.from(document.querySelectorAll('[data-slot="command-item"]'))
            .some((item) => item.textContent?.includes(${JSON.stringify(MODEL_LABEL)}))`, {
            timeoutMs: 60_000,
            label: "configured DSH account model",
          });
          const marked = await ctx.eval(`(() => {
            const model = Array.from(document.querySelectorAll('[data-slot="command-item"]'))
              .find((item) => item.textContent?.includes(${JSON.stringify(MODEL_LABEL)}));
            model?.setAttribute("data-fraimz-model-selection", "true");
            return Boolean(model);
          })()`);
          ctx.assert(marked, "Could not mark the configured DSH model for selection.");
          await ctx.trustedClick('[data-fraimz-model-selection="true"]');
          await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
            .some((button) => button.getClientRects().length > 0
              && /切换模型|Change model/.test(button.getAttribute("aria-label") ?? "")
              && button.textContent?.includes(${JSON.stringify(MODEL_DISPLAY_LABEL)}))`, {
            timeoutMs: 5_000,
            label: "selected model composer label",
          });
          await ctx.waitFor(`(() => {
            try {
              const preferences = JSON.parse(localStorage.getItem("ipollowork.preferences") ?? "null");
              return preferences?.model?.providerID === "deepseek-official"
                && preferences?.model?.modelID === "deepseek-v4-flash";
            } catch { return false; }
          })()`, { timeoutMs: 5_000, label: "persisted selected model" });
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const trigger = Array.from(document.querySelectorAll("button"))
              .find((button) => button.getClientRects().length > 0
                && /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""));
            const preferences = JSON.parse(localStorage.getItem("ipollowork.preferences") ?? "null");
            return {
              hash: location.hash,
              modelLabel: trigger?.textContent?.trim() ?? "",
              selectedModel: preferences?.model ?? null,
              directoryOpen: Array.from(document.querySelectorAll('[data-slot="command-item"]'))
                .some((item) => item.getClientRects().length > 0),
              text: document.body.innerText,
            };
          })()`);
          ctx.assert(state.hash.includes(`/workspace/${ids.dsh}/session`), "The flow left DSH for another page.");
          ctx.assert(state.modelLabel.includes(MODEL_DISPLAY_LABEL), "The composer did not show the selected Flash model.");
          ctx.assert(state.selectedModel?.providerID === "deepseek-official", "The selected provider was not persisted.");
          ctx.assert(state.selectedModel?.modelID === "deepseek-v4-flash", "The selected model was not persisted.");
          ctx.assert(!state.directoryOpen, "The model directory did not close after selection.");
          ctx.assert(!state.hash.includes("/settings"), "Settings was opened to hydrate the model directory.");
          ctx.assert(!state.text.includes("模型不可用"), "The hydrated model was still reported unavailable.");
        },
        screenshot: {
          name: "dsh-selected-model-shown-in-composer",
          requireText: [MODEL_DISPLAY_LABEL],
          rejectText: ["模型不可用", "连接此提供商以浏览和保存模型"],
          hashIncludes: `/workspace/${ids.dsh}/session`,
        },
      });
    },
  }],
};
