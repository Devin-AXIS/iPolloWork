async function findDeepSeekWorkspace(ctx) {
  return ctx.eval(`(async () => {
    const port = localStorage.getItem("ipollowork.server.port");
    const token = localStorage.getItem("ipollowork.server.token");
    if (!port || !token) return null;
    const response = await fetch("http://127.0.0.1:" + port + "/workspaces", {
      headers: { Authorization: "Bearer " + token },
    });
    const payload = await response.json();
    const workspaces = Array.isArray(payload) ? payload : payload.items ?? payload.workspaces ?? [];
    return workspaces.find((workspace) => workspace.engineId === "deepseek-harness")?.id ?? null;
  })()`, { awaitPromise: true });
}

async function openModelDirectory(ctx) {
  await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
    .some((button) => button.getClientRects().length > 0
      && !button.disabled
      && /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""))`, {
    timeoutMs: 60_000,
    label: "enabled model trigger",
  });
  await ctx.eval(`(() => {
    const trigger = Array.from(document.querySelectorAll("button"))
      .find((button) => button.getClientRects().length > 0
        && !button.disabled
        && /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""));
    trigger?.click();
    return Boolean(trigger);
  })()`);
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
  ctx.assert(opened, "Could not open the full model directory.");
}

export default {
  id: "retired-gpt-models-hidden",
  title: "Retired GPT models are absent from the DSH model picker",
  kind: "user-facing",
  steps: [{
    name: "Open the DSH model directory and inspect GPT versions",
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
        timeoutMs: 60_000,
        label: "iPolloWork control API",
      });
      const workspaceId = await findDeepSeekWorkspace(ctx);
      ctx.assert(Boolean(workspaceId), "A DeepSeek Harness workspace is required.");

      await ctx.prove("Only supported GPT chat versions remain selectable", {
        voiceover: "打开 DeepSeek Harness 的模型列表后，只保留 GPT-5.5 及以上版本，已经停用的旧 GPT 模型不再出现。",
        action: async () => {
          await ctx.navigateHash(`/workspace/${workspaceId}/session`);
          await openModelDirectory(ctx);
          await ctx.waitFor(`Array.from(document.querySelectorAll('[data-slot="command-item"]'))
            .some((item) => /GPT[- ]?5\\.5/i.test(item.textContent ?? ""))`, {
            timeoutMs: 60_000,
            label: "supported GPT-5.5 row",
          });
        },
        assert: async () => {
          const models = await ctx.eval(`Array.from(document.querySelectorAll('[data-slot="command-item"]'))
            .map((item) => item.textContent?.trim() ?? "")
            .filter(Boolean)`);
          ctx.assert(models.some((model) => /GPT[- ]?5\.5/i.test(model)), "GPT-5.5 is missing from the model picker.");
          ctx.assert(!models.some((model) => (
            /GPT[- ]?4/i.test(model) || /GPT[- ]?5(?:\.[0-4])?(?!\.\d)/i.test(model)
          )),
            `A retired GPT model is still selectable: ${JSON.stringify(models)}`);
        },
        screenshot: {
          name: "dsh-supported-gpt-models-only",
          requireText: ["切换模型", "GPT-5.5"],
          rejectText: ["GPT-5.4", "GPT-5.3", "GPT-4"],
          hashIncludes: `/workspace/${workspaceId}/session`,
        },
      });
    },
  }],
};
