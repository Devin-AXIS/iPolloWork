export default {
  id: "engine-official-resources",
  title: "Official Agent engines are reused without duplicate downloads",
  kind: "user-facing",
  steps: [
    {
      name: "Official DeepSeek resources are ready",
      run: async (ctx) => {
        await ctx.prove("Installed official DeepSeek resources are ready and cannot be uninstalled in iPolloWork", {
          voiceover: "The engine manager finds the official DeepSeek installations already on this device, uses them immediately, and explains why iPolloWork does not offer install or uninstall actions for them.",
          action: async () => {
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30_000 });
            await ctx.navigateHash("/settings/engines");
          },
          assert: async () => {
            await ctx.waitFor(`(() => {
              const rows = [...document.querySelectorAll('[data-testid="engine-package-row"]')];
              return rows.some((row) => row.getAttribute('data-engine-id') === 'deepseek-harness');
            })()`, { timeoutMs: 30_000, label: "engine package rows" });
            await ctx.waitFor(
              `!document.querySelector('[data-testid="startup-logo-animation"]')`,
              { timeoutMs: 30_000, label: "startup overlay dismissed" },
            );
            const engines = await ctx.eval(`(() => [...document.querySelectorAll('[data-testid="engine-package-row"]')]
              .filter((row) => ['deepseek-harness'].includes(row.getAttribute('data-engine-id')))
              .map((row) => ({
                id: row.getAttribute('data-engine-id'),
                text: row.innerText,
                actions: [...row.querySelectorAll('button')].map((button) => button.innerText.trim()),
              })))()`);
            ctx.assert(Array.isArray(engines) && engines.length === 1, "Expected the DeepSeek optional engine row.");
            for (const engine of engines) {
              ctx.assert(
                engine.text.includes("Using official installation") || engine.text.includes("使用官方安装资源"),
                `Expected ${engine.id} to use an official installation.`,
              );
              ctx.assert(
                engine.text.includes("cannot be uninstalled") || engine.text.includes("不支持在 iPolloWork 中卸载"),
                `Expected ${engine.id} to explain that official resources cannot be uninstalled here.`,
              );
              ctx.assert(engine.actions.length === 0, `Expected ${engine.id} to have no install or uninstall action.`);
            }
          },
          screenshot: {
            name: "official-engine-resources",
            requireText: ["DeepSeek Harness"],
            rejectText: ["Codex Harness"],
            hashIncludes: "/settings/engines",
          },
        });
      },
    },
  ],
};
