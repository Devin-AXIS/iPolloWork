export default {
  id: "engine-official-resources",
  title: "Personal Codex is isolated while official DeepSeek remains reusable",
  kind: "user-facing",
  steps: [
    {
      name: "Managed Codex and official DeepSeek resources are ready",
      run: async (ctx) => {
        await ctx.prove("Codex uses its pinned client-managed runtime while DeepSeek keeps its official installation", {
          voiceover: "Codex uses the runtime managed by iPolloWork. DeepSeek can still reuse its compatible official installation.",
          action: async () => {
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30_000 });
            await ctx.navigateHash("/settings/engines");
          },
          assert: async () => {
            await ctx.waitFor(`(() => {
              const rows = [...document.querySelectorAll('[data-testid="engine-package-row"]')];
              return rows.some((row) => row.getAttribute('data-engine-id') === 'deepseek-harness')
                && rows.some((row) => row.getAttribute('data-engine-id') === 'codex-harness');
            })()`, { timeoutMs: 30_000, label: "engine package rows" });
            await ctx.waitFor(
              `!document.querySelector('[data-testid="startup-logo-animation"]')`,
              { timeoutMs: 30_000, label: "startup overlay dismissed" },
            );
            const engines = await ctx.eval(`(() => [...document.querySelectorAll('[data-testid="engine-package-row"]')]
              .filter((row) => ['deepseek-harness', 'codex-harness'].includes(row.getAttribute('data-engine-id')))
              .map((row) => ({
                id: row.getAttribute('data-engine-id'),
                text: row.innerText,
                actions: [...row.querySelectorAll('button')].map((button) => button.innerText.trim()),
              })))()`);
            ctx.assert(Array.isArray(engines) && engines.length === 2, "Expected both optional engine rows.");
            for (const engine of engines) {
              if (engine.id === 'codex-harness') {
                const codex = await ctx.eval("import('/src/app/lib/desktop.ts').then(async m=>(await m.enginePackagesList()).find(e=>e.id==='codex-harness'))", {awaitPromise:true});
                ctx.assert(codex.installed && codex.source === 'downloaded' && codex.version === '0.149.0', 'Codex must use the pinned client runtime');
                continue;
              }
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
            requireText: ["DeepSeek Harness", "Codex Harness"],
            hashIncludes: "/settings/engines",
          },
        });
      },
    },
  ],
};
