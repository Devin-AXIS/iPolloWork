import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default {
  id: "packaged-plugin-catalog",
  title: "The installed desktop shows its local plugin collection despite a workspace file conflict",
  kind: "user-facing",
  requiredEnv: ["IPOLLOWORK_EVAL_PACKAGED_PLUGIN_ROOT", "IPOLLOWORK_EVAL_PLUGIN_CONFLICT_FILE"],
  steps: [{
    name: "Refresh the packaged personal plugin collection without overwriting customized files",
    run: async ctx => {
      const collection = JSON.parse(readFileSync(join(process.env.IPOLLOWORK_EVAL_PACKAGED_PLUGIN_ROOT, "collection.json"), "utf8"));
      const expected = collection.plugins.map(item => item.pluginId).filter(id => id !== "reference-context").sort();
      ctx.assert(expected.length >= 20, "The installer must include the branch's full local collection");
      const conflictFile = process.env.IPOLLOWORK_EVAL_PLUGIN_CONFLICT_FILE;
      let original;
      const customized = "# Customized workspace Skill retained during catalog refresh\n";
      try {
        await ctx.prove("安装版显示完整的本地插件集，已有文件冲突不会阻断刷新", {
          voiceover: "打开安装版的个人插件页，本地插件集正常显示，刷新时也会保留工作区里已经修改的文件。",
          action: async () => {
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000 });
            await ctx.waitFor(`!document.querySelector('#ipollowork-startup-splash, [data-testid="startup-logo-animation"]')`, { timeoutMs: 60_000 });
            await ctx.eval(`(() => {
              const original = window.fetch;
              window.__packagedCatalogProof = {};
              window.__restorePackagedCatalogProof = () => { window.fetch = original; };
              window.fetch = async (...args) => {
                const response = await original(...args);
                if (/\\/plugin-packages(?:\\/catalog)?$/.test(response.url)) {
                  const key = response.url.endsWith('/catalog') ? 'catalog' : 'installed';
                  window.__packagedCatalogProof[key] = { status: response.status, body: await response.clone().json() };
                }
                return response;
              };
            })()`);
            const workspace = await ctx.eval("localStorage.getItem('ipollowork.react.activeWorkspace')");
            ctx.assert(workspace, "The packaged app has an active workspace");
            await ctx.navigateHash(`/workspace/${workspace}/settings/extensions`);
            await ctx.waitFor("Boolean(window.__packagedCatalogProof.catalog && window.__packagedCatalogProof.installed)", { timeoutMs: 60_000 });
            original = readFileSync(conflictFile, "utf8");
            writeFileSync(conflictFile, customized);
            await ctx.eval("window.__packagedCatalogProof = {}");
            ctx.assert(await ctx.eval(`(() => {
              const refresh = [...document.querySelectorAll('button')].find(button => ['刷新', 'Refresh'].includes(button.textContent.trim()));
              refresh?.click();
              return Boolean(refresh);
            })()`), "Refresh is available in the installed app");
            await ctx.waitFor("Boolean(window.__packagedCatalogProof.catalog && window.__packagedCatalogProof.installed)", { timeoutMs: 60_000 });
            await ctx.waitFor(`document.querySelectorAll('[data-testid="plugin-package-list-item"]').length >= ${expected.length}`, { label: "packaged local plugin cards" });
          },
          assert: async () => {
            const responses = await ctx.eval("window.__packagedCatalogProof");
            ctx.assert(responses.installed.status === 200 && responses.catalog.status === 200, "Inventory and catalog stay readable despite the conflict");
            const actual = responses.catalog.body.items.map(item => item.pluginId).sort();
            ctx.assert(JSON.stringify(actual) === JSON.stringify(expected), `Packaged catalog mismatch: ${JSON.stringify(actual)}`);
            ctx.assert(responses.catalog.body.errors.length === 0, "All packaged resources pass the host catalog validator");
            ctx.assert(readFileSync(conflictFile, "utf8") === customized, "Catalog refresh preserves customized workspace files");
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Packaged catalog and inventory remain available without overwriting the conflicting Skill", actual: { plugins: actual, inventoryStatus: responses.installed.status, catalogStatus: responses.catalog.status, customizedFilePreserved: true } });
          },
          screenshot: { name: "packaged-local-plugins", requireText: ["Figma", "GitHub"], rejectText: ["Install targets already exist with different content", "Something went wrong"], hashIncludes: "/settings/extensions" },
        });
      } finally {
        if (original !== undefined) writeFileSync(conflictFile, original);
        await ctx.eval("window.__restorePackagedCatalogProof?.(); delete window.__restorePackagedCatalogProof; delete window.__packagedCatalogProof");
      }
    },
  }],
};
