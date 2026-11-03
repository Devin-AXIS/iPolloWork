const devOnlyMessage = "Auto-updates are available in packaged builds only.";
const fixtureSuffix = Date.now().toString(36);
const providerId = `regression-fixture-${fixtureSuffix}`;
const providerName = `Regression Fixture Provider ${fixtureSuffix}`;

async function workspaces(ctx) {
  return ctx.eval(`(async () => {
    const base = localStorage.getItem("ipollowork.server.urlOverride");
    const response = await fetch(base + "/workspaces", {
      headers: { Authorization: "Bearer " + localStorage.getItem("ipollowork.server.token") },
    });
    if (!response.ok) throw new Error("Workspaces: " + response.status);
    return response.json();
  })()`, { awaitPromise: true });
}

async function openModelPicker(ctx) {
  await ctx.waitFor(`window.__ipolloworkControl?.listActions()
    .some((action) => action.id === "session.model_picker.open" && !action.disabled)`);
  await ctx.control("session.model_picker.open");
  await ctx.waitForText("选择新对话的默认模型");
}

export default {
  id: "startup-update-project-provider",
  title: "Startup update checks and a new provider in an existing project",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)");
    const { items } = await workspaces(ctx);
    ctx.oldProject = items.find((item) => item.path?.includes("ipollowork-regression-") && item.name === "iPolloWork");
    ctx.assert(Boolean(ctx.oldProject), "Use an isolated ipollowork-regression-* desktop profile.");
  },
  steps: [
    {
      name: "Show the startup check result in Settings",
      run: async (ctx) => {
        await ctx.prove("The update check runs before the Updates page is opened", {
          voiceover: "打开设置后，可以看到开发版启动时执行的更新检查及其结果。",
          action: async () => {
            await ctx.navigateHash(`/workspace/${ctx.oldProject.id}/session`);
            await ctx.eval("location.reload(); true");
            await ctx.waitFor(`Boolean(window.__ipolloworkControl)
              && location.hash.endsWith('/session')
              && !document.querySelector('img[alt="iPolloWork Loading"]')
              && Boolean(document.querySelector('[contenteditable="true"]'))`);
            await ctx.navigateHash("/settings/updates");
          },
          assert: async () => {
            await ctx.expectText(devOnlyMessage);
            ctx.assert(!(await ctx.eval("document.body.innerText.includes('已是最新')")),
              "An unsupported check must not say the app is up to date.");
          },
          screenshot: { name: "startup-update-status", requireText: [devOnlyMessage] },
        });
      },
    },
    {
      name: "Return to the project whose model picker was opened before adding a provider",
      run: async (ctx) => {
        const oldRoute = `/workspace/${ctx.oldProject.id}/session`;
        await ctx.navigateHash(oldRoute);
        await openModelPicker(ctx);
        ctx.assert(!(await ctx.eval(`document.body.innerText.includes(${JSON.stringify(providerName)})`)),
          "The old project already lists the fixture provider.");
        await ctx.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
        const { items } = await workspaces(ctx);
        let other = items.find((item) => item.name === "Provider settings fixture"
          && item.path?.includes("ipollowork-regression-"));
        if (!other) {
          await ctx.eval(`document.querySelector('button[aria-label="新建项目"]').click(); true`);
          await ctx.fill('input[placeholder="例如：iPolloWork"]', "Provider settings fixture");
          await ctx.clickText("新建项目", { selector: '[role="dialog"] button' });
          await ctx.waitFor(`location.hash.endsWith("/session") && !location.hash.includes(${JSON.stringify(ctx.oldProject.id)})`, {
            timeoutMs: 30_000,
            label: "second local project",
          });
          other = (await workspaces(ctx)).items.find((item) => item.name === "Provider settings fixture");
        }
        ctx.assert(Boolean(other), "Expected a second project in the isolated profile.");
        await ctx.navigateHash(`/workspace/${other.id}/session`);
        await ctx.waitFor(`location.hash.includes(${JSON.stringify(other.id)}) && Boolean(document.querySelector('[contenteditable="true"]'))`);

        await ctx.prove("The previously opened project lists the provider saved from a different project", {
          voiceover: "在另一个项目的上下文保存测试供应商，再回到已经打开过的项目，模型列表里能看到它。",
          action: async () => {
            // Seed a provider through the same config endpoint used by the
            // Settings save flow. The isolated fixture has no live credential.
            const status = await ctx.eval(`(async () => {
              const base = localStorage.getItem("ipollowork.server.urlOverride");
              const response = await fetch(base + "/workspace/${other.id}/config", {
                method: "PATCH",
                headers: {
                  Authorization: "Bearer " + localStorage.getItem("ipollowork.server.token"),
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ opencode: { provider: {
                  ${JSON.stringify(providerId)}: {
                    name: ${JSON.stringify(providerName)},
                    npm: "@ai-sdk/openai-compatible",
                    options: { baseURL: "https://fixture.invalid/v1", apiKey: "fixture-only" },
                    models: { "regression-model": { name: "Regression Model", tool_call: true } },
                  },
                } } }),
              });
              return response.status;
            })()`, { awaitPromise: true });
            ctx.assert(status === 200, "Fixture provider save failed: " + status);
            await ctx.navigateHash(oldRoute);
            await openModelPicker(ctx);
            await ctx.fill('[role="dialog"] input[placeholder*="搜索提供商和模型"]', providerName);
          },
          assert: async () => {
            await ctx.expectText(providerName, { timeoutMs: 20_000 });
            await ctx.expectText("Regression Model");
            ctx.assert(await ctx.eval(`location.hash.includes(${JSON.stringify(oldRoute)})`), "Expected the original project.");
          },
          screenshot: { name: "existing-project-new-provider", requireText: [providerName, "Regression Model"] },
        });
      },
    },
  ],
};
