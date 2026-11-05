const clickButton = (pattern) => `(() => {
  const button = Array.from(document.querySelectorAll("button")).find((candidate) =>
    ${pattern}.test((candidate.textContent || "").trim())
  );
  if (!button) return false;
  button.click();
  return true;
})()`;

export default {
  id: "cloud-template-source",
  title: "Explore separates Built-in and Cloud while installed Cloud templates remain usable",
  kind: "user-facing",
  requiredEnv: ["IPOLLOWORK_EVAL_CLOUD_TEMPLATE_URL"],
  steps: [
    {
      name: "Prepare an isolated signed-in Cloud profile",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 30_000,
          label: "control API",
        });
        const baseUrl = ctx.env.IPOLLOWORK_EVAL_CLOUD_TEMPLATE_URL.trim();
        await ctx.control("eval.auth.set-base-url", { baseUrl });
        await ctx.eval(`(() => {
          localStorage.setItem("ipollowork.den.authToken", "cloud-template-eval-token");
          localStorage.removeItem("ipollowork.enterprise-connections.v1");
          localStorage.setItem("ipollowork.work-context.v1", "personal");
          window.dispatchEvent(new Event("ipollowork:enterprise-connections-changed"));
          window.dispatchEvent(new CustomEvent("ipollowork:work-context-changed", { detail: "personal" }));
          window.dispatchEvent(new CustomEvent("ipollowork-den-session-updated", {
            detail: { status: "success", baseUrl: ${JSON.stringify(baseUrl)}, token: "cloud-template-eval-token" },
          }));
          return true;
        })()`);
        await ctx.waitFor(
          `document.body.innerText.includes("Cloud Template User") || document.body.innerText.includes("cloud-template@eval.local")`,
          { timeoutMs: 30_000, label: "signed-in Cloud profile" },
        );
        const staleDialog = await ctx.eval(`Boolean(document.querySelector('[role="dialog"]'))`);
        if (staleDialog) {
          await ctx.eval(`document.querySelector('[role="dialog"] [data-slot="dialog-close"]')?.click()`);
          await ctx.waitFor(`!document.querySelector('[role="dialog"]')`, { label: "stale template dialog to close" });
        }
        const opened = await ctx.eval(clickButton("/^(?:模板|Templates)$/u"));
        ctx.assert(opened === true, "Expected the Templates button during setup.");
        await ctx.waitFor(`Boolean(document.querySelector('[role="dialog"]'))`, { label: "template dialog during setup" });
        const builtInSelected = await ctx.eval(clickButton("/^(?:内置|Built-in)$/u"));
        ctx.assert(builtInSelected === true, "Expected the Built-in source during setup.");
        await ctx.eval(`document.querySelector('[role="dialog"] [data-slot="dialog-close"]')?.click()`);
        await ctx.waitFor(`!document.querySelector('[role="dialog"]')`, { label: "prepared template dialog to close" });
      },
    },
    {
      name: "Explore exposes exactly Built-in and Cloud",
      run: async (ctx) => {
        await ctx.prove("A signed-in Cloud account exposes Cloud templates without Enterprise membership", {
          voiceover: "登录 Cloud 后，探索页提供内置和 Cloud 两个来源；Cloud 模板可直接安装到个人模板库。",
          action: async () => {
            const opened = await ctx.eval(clickButton("/^(?:模板|Templates)$/u"));
            ctx.assert(opened === true, "Expected the Templates button.");
            await ctx.waitFor(
              `(() => {
                const dialog = document.querySelector('[role="dialog"]');
                const sourceTabs = dialog && Array.from(dialog.querySelectorAll('[role="tablist"]')).find((item) =>
                  /模板来源|Template source/u.test(item.getAttribute('aria-label') || '')
                );
                const labels = sourceTabs ? Array.from(sourceTabs.querySelectorAll('[role="tab"]')).map((item) => (item.textContent || '').trim()) : [];
                return labels.length === 2 && labels.some((label) => /^(?:内置|Built-in)$/u.test(label)) && labels.includes('Cloud');
              })()`,
              { timeoutMs: 10_000, label: "Cloud template source" },
            );
            const selected = await ctx.eval(clickButton("/^Cloud$/u"));
            ctx.assert(selected === true, "Expected the Cloud template source button.");
            await ctx.waitFor(
              `document.body.innerText.includes("Cloud 品牌提案") && !document.querySelector('[data-testid="template-catalog-loading"]')`,
              { timeoutMs: 10_000, label: "Cloud template catalog" },
            );
          },
          assert: async () => {
            const auth = await ctx.control("auth.status");
            const state = await ctx.eval(`(() => ({
              enterpriseConnections: JSON.parse(localStorage.getItem("ipollowork.enterprise-connections.v1") || "[]").length,
              cloudSelected: Array.from(document.querySelectorAll("button")).some((button) =>
                (button.textContent || "").trim() === "Cloud" && button.getAttribute("aria-selected") === "true"
              ),
            }))()`);
            ctx.assert(auth.status === "signed_in", `Expected signed-in Cloud auth: ${JSON.stringify(auth)}`);
            ctx.assert(state.enterpriseConnections === 0, "The proof profile must not have an Enterprise connection.");
            ctx.assert(state.cloudSelected, "Cloud must be the selected resource source.");
            await ctx.expectText("Cloud 品牌提案");
          },
          screenshot: {
            name: "cloud-template-source-without-enterprise",
            requireText: ["Cloud", "Cloud 品牌提案"],
            rejectText: ["Something went wrong", "cloud_signin_required"],
          },
        });
      },
    },
    {
      name: "Cloud installs into My templates without carrying source filters",
      run: async (ctx) => {
        await ctx.prove("An installed Cloud template is usable from My templates and My templates has no source classification", {
          voiceover: "安装 Cloud 模板后，它进入我的模板；这里不再显示来源分类，并且模板保留可使用状态。",
          action: async () => {
            const installed = await ctx.eval(`(() => {
              const card = Array.from(document.querySelectorAll('[role="dialog"] article')).find((item) =>
                (item.textContent || '').includes('Cloud 品牌提案')
              );
              const button = card && Array.from(card.querySelectorAll('button')).find((item) => !item.disabled);
              if (!button) return false;
              button.click();
              return true;
            })()`);
            ctx.assert(installed === true, "Expected the Cloud template install action.");
            await ctx.waitFor(
              `(() => {
                const card = Array.from(document.querySelectorAll('[role="dialog"] article')).find((item) =>
                  (item.textContent || '').includes('Cloud 品牌提案')
                );
                return Boolean(card && /使用|Use/u.test(card.textContent || ''));
              })()`,
              { timeoutMs: 30_000, label: "installed Cloud template use action" },
            );
            const mySelected = await ctx.eval(clickButton("/^(?:我的模板|My templates)$/u"));
            ctx.assert(mySelected === true, "Expected My templates tab.");
            await ctx.waitFor(
              `(() => {
                const dialog = document.querySelector('[role="dialog"]');
                if (!dialog || dialog.querySelector('[data-testid="template-catalog-loading"]')) return false;
                const sourceTabs = Array.from(dialog.querySelectorAll('[role="tablist"]')).find((item) =>
                  /模板来源|Template source/u.test(item.getAttribute('aria-label') || '')
                );
                return !sourceTabs && dialog.innerText.includes('Cloud 品牌提案');
              })()`,
              { timeoutMs: 30_000, label: "Cloud template in My templates without source tabs" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const dialog = document.querySelector('[role="dialog"]');
              const sourceTabs = dialog && Array.from(dialog.querySelectorAll('[role="tablist"]')).find((item) =>
                /模板来源|Template source/u.test(item.getAttribute('aria-label') || '')
              );
              const card = dialog && Array.from(dialog.querySelectorAll('article')).find((item) =>
                (item.textContent || '').includes('Cloud 品牌提案')
              );
              return { hasSourceTabs: Boolean(sourceTabs), usable: Boolean(card && /使用|Use/u.test(card.textContent || '')) };
            })()`);
            ctx.assert(!state.hasSourceTabs, "My templates must not show Built-in or Cloud source tabs.");
            ctx.assert(state.usable, "The installed Cloud template must remain usable in My templates.");
          },
          screenshot: {
            name: "cloud-template-installed-in-my-templates",
            requireText: ["我的模板", "Cloud 品牌提案"],
            rejectText: ["模板来源", "Something went wrong", "cloud_signin_required"],
          },
        });
      },
    },
  ],
};
