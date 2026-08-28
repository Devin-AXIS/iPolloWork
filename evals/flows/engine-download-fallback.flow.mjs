import { existsSync } from "node:fs";
import path from "node:path";

const ENGINES = [
  { id: "deepseek-harness", version: "0.1.0-rc.6" },
  { id: "codex-harness", version: "0.149.0" },
];

function rowSelector(engineId) {
  return `[data-testid="engine-package-row"][data-engine-id="${engineId}"]`;
}

export default {
  id: "engine-download-fallback",
  title: "Packaged Agent engines install offline from verified bundled packages",
  kind: "user-facing",
  steps: [
    {
      name: "Packaged app installs both optional engines without a network source",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 30_000,
          label: "packaged desktop control bridge",
        });

        await ctx.prove("The packaged app installs Codex and DeepSeek from its verified offline engine bundles", {
          voiceover: "Without a working engine download server, the packaged app still shows the real Codex and DeepSeek versions and installs both engines to a ready state from its built-in resources.",
          action: async () => {
            await ctx.navigateHash("/settings/engines");
            await ctx.waitFor(
              `document.querySelectorAll('[data-testid="engine-package-row"]').length === 3`,
              { timeoutMs: 30_000, label: "all engine package rows" },
            );

            for (const engine of ENGINES) {
              const selector = rowSelector(engine.id);
              const initial = await ctx.eval(`(() => {
                const row = document.querySelector(${JSON.stringify(selector)});
                return row ? row.innerText : null;
              })()`);
              ctx.assert(Boolean(initial), `${engine.id} row must be visible.`);
              ctx.assert(initial.includes(`v${engine.version}`), `${engine.id} must show v${engine.version} before install.`);
              ctx.assert(!initial.toLowerCase().includes("unknown"), `${engine.id} must never show an unknown version.`);

              await ctx.eval(`(() => {
                const row = document.querySelector(${JSON.stringify(selector)});
                const button = row?.querySelector("button");
                if (!button) throw new Error(${JSON.stringify(`${engine.id} install button is missing`)});
                button.click();
                return true;
              })()`);
              await ctx.waitFor(
                `(() => {
                  const text = document.querySelector(${JSON.stringify(selector)})?.innerText ?? "";
                  return text.includes("Ready") || text.includes("已就绪");
                })()`,
                { timeoutMs: 120_000, label: `${engine.id} ready state` },
              );
            }
          },
          assert: async () => {
            const userData = ctx.env.IPOLLOWORK_ELECTRON_USERDATA?.trim();
            ctx.assert(Boolean(userData), "The isolated packaged-app userData path must be provided.");
            for (const engine of ENGINES) {
              const selector = rowSelector(engine.id);
              const text = await ctx.eval(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ""`);
              ctx.assert(text.includes(`v${engine.version}`), `${engine.id} must keep its real version after install.`);
              ctx.assert(text.includes("Ready") || text.includes("已就绪"), `${engine.id} must finish ready.`);
              ctx.assert(!text.includes("HTTP 404"), `${engine.id} must not fall back to a missing GitHub release.`);
              ctx.assert(
                existsSync(path.join(userData, "engine-packs", engine.id, engine.version, `${process.platform}-${process.arch}`)),
                `${engine.id} must install runtime files under the isolated userData directory.`,
              );
            }
          },
          screenshot: {
            name: "packaged-engines-ready-offline",
            requireText: ["DeepSeek Harness", "Codex Harness"],
            rejectText: ["unknown", "HTTP 404", "Engine package release metadata could not resolve"],
            hashIncludes: "/settings/engines",
          },
        });
      },
    },
  ],
};
