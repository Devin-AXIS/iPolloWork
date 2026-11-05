const MODEL_LABEL = "DeepSeek-V4-Flash";
const CONNECTION_NAME = "Windows Enterprise Model Probe";
const CONNECTIONS_KEY = "ipollowork.enterprise-connections.v1";
const CONTEXT_KEY = "ipollowork.work-context.v1";

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
  ctx.assert(opened, "Could not find the visible model trigger.");
  await ctx.waitForText("切换模型", { timeoutMs: 10_000 });
  const directoryOpened = await ctx.eval(`(() => {
    const candidates = Array.from(document.querySelectorAll("button"))
      .filter((button) => button.textContent?.includes("切换模型")
        && !/切换模型|Change model/.test(button.getAttribute("aria-label") ?? "")
        && button.getClientRects().length > 0);
    candidates.at(-1)?.click();
    return candidates.length > 0;
  })()`);
  ctx.assert(directoryOpened, "Could not open the model directory.");
}

async function workspaceFixture(ctx) {
  return await ctx.eval(`(async () => {
    const port = localStorage.getItem("ipollowork.server.port");
    const token = localStorage.getItem("ipollowork.server.token");
    if (!port || !token) return { error: "missing local server connection" };
    const response = await fetch("http://127.0.0.1:" + port + "/workspaces", {
      headers: { Authorization: "Bearer " + token },
    });
    const payload = await response.json();
    const workspaces = Array.isArray(payload) ? payload : payload.workspaces ?? payload.items ?? [];
    const personal = workspaces.find((workspace) =>
      (!workspace.workContextId || workspace.workContextId === "personal")
      && (!workspace.engineId || workspace.engineId === "opencode"));
    const enterprise = workspaces.find((workspace) =>
      typeof workspace.workContextId === "string"
      && workspace.workContextId.startsWith("enterprise:")
      && (!workspace.engineId || workspace.engineId === "opencode"));
    return {
      personalId: personal?.id,
      enterpriseId: enterprise?.id,
      enterpriseContext: enterprise?.workContextId,
    };
  })()`, { awaitPromise: true });
}

async function restoreFixture(ctx) {
  await ctx.eval(`(() => {
    if (window.__fraimzEnterpriseProviderOriginalFetch) {
      window.fetch = window.__fraimzEnterpriseProviderOriginalFetch;
      delete window.__fraimzEnterpriseProviderOriginalFetch;
    }
    const originalConnections = sessionStorage.getItem("fraimz-enterprise-provider-connections");
    if (originalConnections === null) localStorage.removeItem(${JSON.stringify(CONNECTIONS_KEY)});
    else localStorage.setItem(${JSON.stringify(CONNECTIONS_KEY)}, originalConnections);
    localStorage.setItem(${JSON.stringify(CONTEXT_KEY)}, "personal");
    sessionStorage.removeItem("fraimz-enterprise-provider-connections");
    window.dispatchEvent(new CustomEvent("ipollowork:enterprise-connections-changed"));
    return true;
  })()`);
}

export default {
  id: "enterprise-provider-model-loading-fast",
  title: "Enterprise model directories reuse the account provider catalog during Windows cold starts",
  kind: "user-facing",
  steps: [{
    name: "Switch from personal to Enterprise while the new provider request is pending",
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
        timeoutMs: 60_000,
        label: "iPolloWork control API",
      });
      const fixture = await workspaceFixture(ctx);
      ctx.assert(!fixture.error, fixture.error ?? "Could not read workspaces.");
      ctx.assert(Boolean(fixture.personalId), "A personal OpenCode workspace is required.");
      ctx.assert(Boolean(fixture.enterpriseId), "An Enterprise OpenCode workspace is required.");
      ctx.assert(
        typeof fixture.enterpriseContext === "string" && fixture.enterpriseContext.startsWith("enterprise:"),
        "The Enterprise workspace has no valid work context.",
      );
      const enterpriseConnectionId = fixture.enterpriseContext.slice("enterprise:".length);

      await ctx.navigateHash(`/workspace/${fixture.personalId}/session`);
      await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
        .some((button) => /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""))`, {
        timeoutMs: 60_000,
        label: "personal model trigger",
      });
      await openModelDirectory(ctx);
      await ctx.waitForText(MODEL_LABEL, { timeoutMs: 90_000 });
      await closeTransientUi(ctx);
      await closeTransientUi(ctx);

      await ctx.navigateHash(`/workspace/${fixture.personalId}/settings/cloud-account`);
      await ctx.waitForText("工作空间", { timeoutMs: 60_000 });
      await ctx.eval(`(() => {
        const original = localStorage.getItem(${JSON.stringify(CONNECTIONS_KEY)});
        if (original === null) sessionStorage.removeItem("fraimz-enterprise-provider-connections");
        else sessionStorage.setItem("fraimz-enterprise-provider-connections", original);
        let connections = [];
        try { connections = JSON.parse(original ?? "[]"); } catch {}
        const probe = {
          id: ${JSON.stringify(enterpriseConnectionId)},
          name: ${JSON.stringify(CONNECTION_NAME)},
          shortName: "企业",
          origin: "http://127.0.0.1:39123",
          logoUrl: null,
          accent: "blue",
          authMode: "ipollo_oidc",
          membership: { id: "member-windows-model-probe", role: "member" },
          session: { token: "fraimz-session", expiresAt: "2099-01-01T00:00:00.000Z" },
        };
        localStorage.setItem(${JSON.stringify(CONNECTIONS_KEY)}, JSON.stringify([
          ...connections.filter((connection) => connection?.id !== probe.id),
          probe,
        ]));
        window.dispatchEvent(new CustomEvent("ipollowork:enterprise-connections-changed"));
        const originalFetch = window.fetch;
        window.__fraimzEnterpriseProviderOriginalFetch = originalFetch;
        window.__fraimzEnterpriseProviderPending = 0;
        window.fetch = (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/workspace/${fixture.enterpriseId}/opencode/provider")) {
            window.__fraimzEnterpriseProviderPending += 1;
            return new Promise(() => {});
          }
          return originalFetch(input, init);
        };
        return true;
      })()`);

      try {
        await ctx.clickText(CONNECTION_NAME, { selector: "button", timeoutMs: 10_000 });
        await ctx.waitFor(`location.hash.includes(${JSON.stringify(`/workspace/${fixture.enterpriseId}/session`)})`, {
          timeoutMs: 60_000,
          label: "Enterprise session route",
        });
        await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
          .some((button) => /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""))`, {
          timeoutMs: 60_000,
          label: "Enterprise model trigger",
        });

        await ctx.prove("Enterprise model choices appear immediately even while the Windows runtime catalog is still pending", {
          voiceover: "切换到企业工作空间后，个人账号绑定的供应商模型会立即显示；Windows 上较慢的引擎刷新继续在后台完成。",
          action: async () => {
            const startedAt = Date.now();
            await openModelDirectory(ctx);
            await ctx.waitFor(`Array.from(document.querySelectorAll('[data-slot="command-item"]'))
              .some((item) => item.textContent?.includes(${JSON.stringify(MODEL_LABEL)}))`, {
              timeoutMs: 2_000,
              label: "cached Enterprise model row",
            });
            ctx.modelOpenElapsedMs = Date.now() - startedAt;
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              pendingRequests: window.__fraimzEnterpriseProviderPending ?? 0,
              text: document.body.innerText,
              modelEnabled: Array.from(document.querySelectorAll('[data-slot="command-item"]'))
                .some((item) => item.textContent?.includes(${JSON.stringify(MODEL_LABEL)})
                  && item.getAttribute("aria-disabled") !== "true"
                  && !item.hasAttribute("data-disabled")),
            }))()`);
            ctx.assert(state.pendingRequests > 0, "The Enterprise provider request was not held pending.");
            ctx.assert(state.modelEnabled, "The cached account model is not selectable.");
            ctx.assert(ctx.modelOpenElapsedMs < 2_000, `The model row took ${ctx.modelOpenElapsedMs}ms to appear.`);
            ctx.assert(!state.text.includes("正在加载提供商"), "The picker is still blocked by provider loading.");
          },
          screenshot: {
            name: "enterprise-models-before-runtime-refresh",
            requireText: ["切换模型", "DeepSeek", MODEL_LABEL],
            rejectText: ["正在加载提供商", "模型不可用"],
            hashIncludes: `/workspace/${fixture.enterpriseId}/session`,
          },
        });
      } finally {
        await closeTransientUi(ctx).catch(() => {});
        await restoreFixture(ctx);
        await ctx.eval("location.reload(); true");
      }
    },
  }],
};
