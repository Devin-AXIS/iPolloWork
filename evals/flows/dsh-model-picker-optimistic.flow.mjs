const MODEL_LABEL = "DeepSeek-V4-Flash";

async function closeTransientUi(ctx) {
  await ctx.eval(`(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return true;
  })()`);
}

async function openModelDirectory(ctx) {
  const opened = await ctx.eval(`(() => {
    const trigger = Array.from(document.querySelectorAll("button"))
      .find((button) => {
        const rect = button.getBoundingClientRect();
        return !button.disabled
          && rect.width > 0
          && rect.height > 0
          && /切换模型|Change model/.test(button.getAttribute("aria-label") ?? "");
      });
    trigger?.click();
    return Boolean(trigger);
  })()`);
  ctx.assert(opened, "Could not find an enabled, visible model trigger.");
  await ctx.waitForText("切换模型", { timeoutMs: 10_000 });
  const directoryOpened = await ctx.eval(`(() => {
    const candidates = Array.from(document.querySelectorAll("button"))
      .filter((button) => button.textContent?.includes("切换模型")
        && !/切换模型|Change model/.test(button.getAttribute("aria-label") ?? "")
        && button.getBoundingClientRect().width > 0
        && button.getBoundingClientRect().height > 0);
    candidates.at(-1)?.click();
    return candidates.length > 0;
  })()`);
  ctx.assert(directoryOpened, "Could not open the model directory from the behavior menu.");
}

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
      opencode: workspaces.find((workspace) => !workspace.engineId || workspace.engineId === "opencode")?.id,
    };
  })()`, { awaitPromise: true });
}

export default {
  id: "dsh-model-picker-optimistic",
  title: "DeepSeek Harness model selection does not wait for runtime validation",
  kind: "user-facing",
  steps: [{
    name: "Open the DSH model directory while its runtime request is pending",
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
        timeoutMs: 60_000,
        label: "iPolloWork control API",
      });
      const ids = await workspaceIds(ctx);
      ctx.assert(!ids.error, ids.error ?? "Could not read workspaces.");
      ctx.assert(Boolean(ids.dsh), "A DeepSeek Harness workspace is required.");
      ctx.assert(Boolean(ids.opencode), "An OpenCode workspace is required for the account catalog.");

      // Start from OpenCode so its account catalog is cached before DSH begins
      // runtime discovery. This mirrors a normal cross-engine switch.
      await ctx.eval(`(() => {
        localStorage.setItem("ipollowork.react.activeWorkspace", ${JSON.stringify(ids.opencode)});
        location.reload();
        return true;
      })()`);
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
        timeoutMs: 60_000,
        label: "reloaded iPolloWork control API",
      });
      await ctx.navigateHash(`/workspace/${ids.opencode}/session`);
      await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
        .some((button) => /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""))`, {
        timeoutMs: 60_000,
        label: "OpenCode model trigger",
      });
      await openModelDirectory(ctx);
      await ctx.waitForText(MODEL_LABEL, { timeoutMs: 60_000 });
      await closeTransientUi(ctx);
      await closeTransientUi(ctx);

      await ctx.prove("DeepSeek Harness models remain selectable while runtime validation is still pending", {
        voiceover: "进入 DeepSeek Harness 后，模型列表会立即可选，后台校验不会再把选项锁住。",
        action: async () => {
          await ctx.eval(`(() => {
            const originalFetch = window.fetch;
            window.__ipolloworkFraimzOriginalFetch = originalFetch;
            window.__ipolloworkFraimzPendingDshRequests = 0;
            window.fetch = (input, init) => {
              const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
              if (url.includes("/engine/deepseek-harness/rpc")) {
                window.__ipolloworkFraimzPendingDshRequests += 1;
                return new Promise(() => {});
              }
              return originalFetch(input, init);
            };
            return true;
          })()`);
          await ctx.navigateHash(`/workspace/${ids.dsh}/session`);
          await ctx.waitFor("window.__ipolloworkFraimzPendingDshRequests > 0", {
            timeoutMs: 10_000,
            label: "pending DSH runtime validation",
          });
          const startedAt = Date.now();
          await openModelDirectory(ctx);
          await ctx.waitFor(`Array.from(document.querySelectorAll('[data-slot="command-item"]'))
            .some((item) => item.textContent?.includes(${JSON.stringify(MODEL_LABEL)}))`, {
            timeoutMs: 2_000,
            label: "immediate account model row",
          });
          ctx.modelOpenElapsedMs = Date.now() - startedAt;
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {
            const button = Array.from(document.querySelectorAll('[data-slot="command-item"]'))
              .find((candidate) => candidate.textContent?.includes(${JSON.stringify(MODEL_LABEL)}));
            return {
              pendingRequests: window.__ipolloworkFraimzPendingDshRequests,
              enabled: Boolean(button
                && !button.hasAttribute("data-disabled")
                && button.getAttribute("aria-disabled") !== "true"),
              text: document.body.innerText,
            };
          })()`);
          ctx.assert(state.pendingRequests > 0, "DSH runtime validation was not held pending.");
          ctx.assert(state.enabled, "The account model was disabled while DSH validation was pending.");
          ctx.assert(ctx.modelOpenElapsedMs < 2_000, `The model row took ${ctx.modelOpenElapsedMs}ms to appear.`);
          ctx.assert(!state.text.includes("正在加载提供商"), "The picker still blocks on provider loading.");
        },
        screenshot: {
          name: "dsh-model-selectable-before-validation",
          requireText: ["切换模型", "DeepSeek", MODEL_LABEL],
          rejectText: [
            "正在加载提供商",
            "连接此提供商以浏览和保存模型",
            "模型不可用",
            "DeepSeek Harness returned HTTP 404",
          ],
        },
      });

      await ctx.eval(`(() => {
        if (window.__ipolloworkFraimzOriginalFetch) {
          window.fetch = window.__ipolloworkFraimzOriginalFetch;
          delete window.__ipolloworkFraimzOriginalFetch;
        }
        delete window.__ipolloworkFraimzPendingDshRequests;
        location.reload();
        return true;
      })()`);
    },
  }],
};
