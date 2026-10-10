const MODEL_LABEL = "Nemotron 3.5 Lightning Free";

async function closeTransientUi(ctx) {
  await ctx.eval(`(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return true;
  })()`);
}

async function openModelDirectory(ctx) {
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
}

async function visibleModelDirectoryState(ctx) {
  return await ctx.eval(`(() => {
    const dialog = Array.from(document.querySelectorAll('[role="dialog"][data-slot="popover-content"]'))
      .find((element) => element.getClientRects().length > 0
        && element.innerText.includes(${JSON.stringify(MODEL_LABEL)}));
    return dialog ? { visible: true, text: dialog.innerText } : { visible: false, text: "" };
  })()`);
}

export default {
  id: "provider-model-loading-fast",
  title: "Provider and model directories open from cache without blocking the UI",
  kind: "user-facing",
  steps: [{
    name: "Cached model directory and immediate provider dialog",
    run: async (ctx) => {
      if (!(await ctx.eval("Boolean(window.__ipolloworkControl)"))) {
        await ctx.eval("location.reload(); true");
      }
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
        timeoutMs: 60_000,
        label: "iPolloWork control API",
      });
      await closeTransientUi(ctx);
      await ctx.navigateHash("/session");
      await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
        .some((button) => /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""))`, {
        timeoutMs: 60_000,
        label: "session model trigger",
      });

      await openModelDirectory(ctx);
      await ctx.waitFor(`Array.from(document.querySelectorAll('[role="dialog"][data-slot="popover-content"]'))
        .some((element) => element.getClientRects().length > 0
          && element.innerText.includes(${JSON.stringify(MODEL_LABEL)}))`, {
        timeoutMs: 90_000,
        label: "initial warmed model directory",
      });
      await closeTransientUi(ctx);
      await closeTransientUi(ctx);

      await ctx.prove("A warmed model directory reopens immediately with model rows instead of an empty provider loader", {
        voiceover: "再次打开模型列表时，已经缓存的模型立即出现，不再只剩正在加载提供商。",
        action: async () => {
          const startedAt = Date.now();
          await openModelDirectory(ctx);
          await ctx.waitFor(`Array.from(document.querySelectorAll('[role="dialog"][data-slot="popover-content"]'))
            .some((element) => element.getClientRects().length > 0
              && element.innerText.includes(${JSON.stringify(MODEL_LABEL)}))`, {
            timeoutMs: 2_000,
            label: "cached model rows",
          });
          ctx.modelOpenElapsedMs = Date.now() - startedAt;
        },
        assert: async () => {
          const state = await visibleModelDirectoryState(ctx);
          ctx.assert(state.visible, "The cached model directory did not become visible.");
          ctx.assert(
            ctx.modelOpenElapsedMs < 2_000,
            `Cached model directory took ${ctx.modelOpenElapsedMs}ms to open.`,
          );
          ctx.assert(
            !state.text.trim().startsWith("正在加载提供商"),
            "The model directory still opened as an empty provider loader.",
          );
        },
        screenshot: {
          name: "cached-model-directory",
          requireText: [MODEL_LABEL],
          rejectText: ["模型不可用"],
        },
      });

      await closeTransientUi(ctx);
      await ctx.navigateHash("/settings/ai");
      await ctx.waitForText("连接提供商", { timeoutMs: 60_000 });
      await ctx.prove("Connect provider opens its dialog immediately while live provider metadata refreshes inside it", {
        voiceover: "点击连接提供商后弹窗立即打开，实时健康检查和认证目录不再把按钮长时间卡住。",
        action: async () => {
          const startedAt = Date.now();
          await ctx.clickText("连接提供商", { selector: "button", timeoutMs: 10_000 });
          await ctx.waitFor(`Array.from(document.querySelectorAll('[role="dialog"]'))
            .some((element) => element.getClientRects().length > 0
              && element.innerText.includes("Connect providers"))`, {
            timeoutMs: 2_000,
            label: "provider dialog",
          });
          ctx.providerDialogElapsedMs = Date.now() - startedAt;
        },
        assert: async () => {
          ctx.assert(
            ctx.providerDialogElapsedMs < 2_000,
            `Provider dialog took ${ctx.providerDialogElapsedMs}ms to open.`,
          );
          await ctx.expectText("Connect providers", { timeoutMs: 1_000 });
        },
        screenshot: {
          name: "provider-dialog-immediate",
          requireText: ["Connect providers"],
          hashIncludes: "/settings/ai",
        },
      });
    },
  }],
};
