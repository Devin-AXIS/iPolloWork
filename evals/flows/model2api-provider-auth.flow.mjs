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

async function selectModel2ApiV4Pro(ctx) {
  await ctx.control("session.model_picker.open");
  await ctx.waitForText("Model2API", { timeoutMs: 15_000 });
  const providerState = await ctx.eval(`(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.includes("Model2API")
        && candidate.getClientRects().length > 0);
    button?.setAttribute("data-fraimz-model2api-provider", "true");
    return {
      found: Boolean(button),
      expanded: button?.querySelector("svg")?.classList.contains("lucide-chevron-down") ?? false,
    };
  })()`);
  ctx.assert(providerState.found, "Could not mark the Model2API model provider.");
  if (!providerState.expanded) {
    await ctx.trustedClick('[data-fraimz-model2api-provider="true"]');
  }
  await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
    .filter((button) => button.textContent?.includes("DeepSeek-V4-Pro")
      && button.getClientRects().length > 0).length >= 1`, {
    timeoutMs: 15_000,
    label: "Model2API DeepSeek V4 Pro model card",
  });
  const modelMarked = await ctx.eval(`(() => {
    const buttons = Array.from(document.querySelectorAll("button"))
      .filter((candidate) => candidate.textContent?.includes("DeepSeek-V4-Pro")
        && candidate.getClientRects().length > 0);
    const button = buttons.at(-1);
    button?.setAttribute("data-fraimz-model2api-v4-pro", "true");
    return Boolean(button);
  })()`);
  ctx.assert(modelMarked, "Could not mark Model2API DeepSeek V4 Pro.");
  await ctx.trustedClick('[data-fraimz-model2api-v4-pro="true"]');
  await ctx.waitForText("Deepseek V4 PRO", { timeoutMs: 15_000 });
}

export default {
  id: "model2api-provider-auth",
  title: "Model2API appears in the provider authorization flow",
  kind: "user-facing",
  steps: [
    {
      name: "Find Model2API in provider settings",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 60_000,
          label: "iPolloWork control API",
        });
        const workspaceId = await openCodeWorkspaceId(ctx);
        ctx.assert(Boolean(workspaceId), "An OpenCode workspace is required.");

        await ctx.prove("Model2API is available in the provider connection flow", {
          voiceover: "在模型供应商列表中可以直接找到 Model2API，并查看它的连接状态。",
          action: async () => {
            await ctx.navigateHash(`/workspace/${workspaceId}/settings/ai`);
            await ctx.waitFor(`document.body.innerText.includes("Model2API")
              && !document.body.innerText.includes("正在拉取任务的最新消息")
              && Array.from(document.querySelectorAll("button"))
                .some((button) => /Connect provider|连接提供商/.test(button.textContent ?? "")
                  && button.getClientRects().length > 0
                  && !button.disabled)`, {
              timeoutMs: 60_000,
              label: "loaded provider settings",
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
              const button = Array.from(document.querySelectorAll('[role="dialog"] button'))
                .find((candidate) => candidate.textContent?.includes("Model2API")
                  && candidate.getClientRects().length > 0);
              button?.setAttribute("data-fraimz-model2api", "true");
              return Boolean(button);
            })()`);
            ctx.assert(marked, "Could not mark the Model2API provider row.");
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              text: document.body.innerText,
              provider: document.querySelector('[data-fraimz-model2api="true"]')?.textContent ?? "",
            }))()`);
            ctx.assert(state.text.includes("Model2API"), "The provider picker does not identify Model2API.");
            ctx.assert(state.provider.includes("model2api"), "The Model2API provider ID is missing.");
            ctx.assert(state.provider.includes("API密钥") || state.provider.includes("API key"), "The Model2API API key method is missing.");
          },
          screenshot: {
            name: "model2api-provider-connection",
            requireText: ["Connect providers", "Model2API"],
            rejectText: ["No providers available.", "No providers match your search."],
            hashIncludes: `/workspace/${workspaceId}/settings/ai`,
          },
        });
      },
    },
    {
      name: "Use DeepSeek V4 Pro without unsupported tools",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 60_000,
          label: "iPolloWork control API",
        });
        const workspaceId = await openCodeWorkspaceId(ctx);
        ctx.assert(Boolean(workspaceId), "An OpenCode workspace is required.");

        await ctx.prove("Model2API DeepSeek V4 Pro completes a text-only conversation", {
          voiceover: "选择 DeepSeek V4 Pro 后，普通对话会自动使用无工具模式并正常回复。",
          action: async () => {
            await ctx.navigateHash(`/workspace/${workspaceId}/session`);
            await ctx.waitFor(`window.__ipolloworkControl.listActions()
              .some((action) => action.id === "session.model_picker.open" && !action.disabled)`, {
              timeoutMs: 60_000,
              label: "model picker action",
            });
            await selectModel2ApiV4Pro(ctx);
            await ctx.control("session.create_task");
            await ctx.waitFor(`location.hash.includes("/workspace/${workspaceId}/session/")`, {
              timeoutMs: 30_000,
              label: "new Model2API conversation",
            });
            await ctx.waitFor(`window.__ipolloworkControl.listActions()
              .some((action) => action.id === "composer.set_text" && !action.disabled)`, {
              timeoutMs: 30_000,
              label: "composer actions",
            });
            await ctx.control("composer.set_text", { text: "只回复：V4-PRO-OK" });
            await ctx.control("composer.send");
            await ctx.waitFor(`Array.from(document.querySelectorAll('[data-testid="assistant-message-column"]'))
              .some((message) => message.textContent?.includes("V4-PRO-OK"))`, {
              timeoutMs: 90_000,
              label: "DeepSeek V4 Pro text response",
            });
            await ctx.waitFor(`window.__ipolloworkControl.listActions()
              .some((action) => action.id === "composer.stop" && action.disabled)`, {
              timeoutMs: 30_000,
              label: "completed Model2API turn",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              text: document.body.innerText,
              response: Array.from(document.querySelectorAll('[data-testid="assistant-message-column"]'))
                .at(-1)?.textContent?.trim() ?? "",
            }))()`);
            ctx.assert(state.response.includes("V4-PRO-OK"), "DeepSeek V4 Pro did not return its text response.");
            ctx.assert(!state.text.includes("模型未开放工具调用"), "The provider still rejected tool calling.");
            ctx.assert(!state.text.includes("Status: 400"), "The provider still returned HTTP 400.");
          },
          screenshot: {
            name: "model2api-v4-pro-text-response",
            targetUrlIncludes: "localhost:5173",
            requireText: ["V4-PRO-OK", "Deepseek V4 PRO"],
            rejectText: ["模型未开放工具调用", "Status: 400", "invalid_request"],
            hashIncludes: `/workspace/${workspaceId}/session/`,
          },
        });
      },
    },
  ],
};
