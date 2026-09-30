async function openCodeWorkspaceId(ctx) {
  return ctx.eval(`(async () => {
    const port = localStorage.getItem("ipollowork.server.port");
    const token = localStorage.getItem("ipollowork.server.token");
    if (!port || !token) return "";
    const response = await fetch("http://127.0.0.1:" + port + "/workspaces", {
      headers: { Authorization: "Bearer " + token },
    });
    const payload = await response.json();
    const workspaces = Array.isArray(payload) ? payload : payload.workspaces ?? [];
    return workspaces.find((workspace) => !workspace.engineId || workspace.engineId === "opencode")?.id ?? "";
  })()`, { awaitPromise: true });
}

export default {
  id: "model2api-provider-auth",
  title: "Model2API appears in the provider authorization flow",
  kind: "user-facing",
  steps: [{
    name: "Open Model2API API key setup from Settings",
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
        timeoutMs: 60_000,
        label: "iPolloWork control API",
      });
      const workspaceId = await openCodeWorkspaceId(ctx);
      ctx.assert(Boolean(workspaceId), "An OpenCode workspace is required.");

      await ctx.prove("Model2API is available as a provider and opens its API key setup", {
        voiceover: "在模型供应商列表中选择 Model2API，就能直接进入 API Key 配置界面。",
        action: async () => {
          await ctx.navigateHash(`/workspace/${workspaceId}/settings/ai`);
          await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
            .some((button) => /Connect provider|连接提供商/.test(button.textContent ?? "")
              && button.getClientRects().length > 0
              && !button.disabled)`, {
            timeoutMs: 60_000,
            label: "connect provider button",
          });
          const opened = await ctx.eval(`(() => {
            const button = Array.from(document.querySelectorAll("button"))
              .find((candidate) => /Connect provider|连接提供商/.test(candidate.textContent ?? "")
                && candidate.getClientRects().length > 0
                && !candidate.disabled);
            button?.click();
            return Boolean(button);
          })()`);
          ctx.assert(opened, "Could not open the provider picker.");
          await ctx.waitForText("Connect providers", { timeoutMs: 15_000 });
          await ctx.fill('input[placeholder="Filter providers by name or ID"]', "model2api");
          await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
            .some((button) => button.textContent?.includes("Model2API")
              && button.getClientRects().length > 0)`, {
            timeoutMs: 10_000,
            label: "Model2API provider row",
          });
          const marked = await ctx.eval(`(() => {
            const button = Array.from(document.querySelectorAll("button"))
              .find((candidate) => candidate.textContent?.includes("Model2API")
                && candidate.getClientRects().length > 0);
            button?.setAttribute("data-fraimz-model2api", "true");
            return Boolean(button);
          })()`);
          ctx.assert(marked, "Could not mark the Model2API provider row.");
          await ctx.trustedClick('[data-fraimz-model2api="true"]');
          await ctx.waitForText("Paste your API key to connect.", { timeoutMs: 10_000 });
        },
        assert: async () => {
          const state = await ctx.eval(`(() => ({
            text: document.body.innerText,
            hasPasswordInput: Boolean(document.querySelector('input[type="password"]')),
            saveDisabled: Array.from(document.querySelectorAll("button"))
              .some((button) => button.textContent?.includes("Save key") && button.disabled),
          }))()`);
          ctx.assert(state.text.includes("Model2API"), "The API key view does not identify Model2API.");
          ctx.assert(state.hasPasswordInput, "The Model2API setup has no protected API key input.");
          ctx.assert(state.saveDisabled, "An empty Model2API key could be submitted.");
        },
        screenshot: {
          name: "model2api-api-key-setup",
          requireText: ["Connect providers", "Model2API", "API key", "Paste your API key to connect.", "Save key"],
          rejectText: ["No providers available.", "No providers match your search."],
          hashIncludes: `/workspace/${workspaceId}/settings/ai`,
        },
      });
    },
  }],
};
