import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("memory-panel-startup-loader");

export default {
  id: "memory-panel-startup-loader",
  title: "Desktop startup loader remains visible and the Memory panel loads from Cloud",
  kind: "user-facing",
  spec: "evals/voiceovers/memory-panel-startup-loader.md",
  steps: [
    {
      name: "A fast desktop reload still shows the startup animation",
      run: async (ctx) => {
        await ctx.prove("The startup animation is visible before the workspace becomes interactive", {
          voiceover: vo[0],
          action: async () => {
            await ctx.client.send("Page.reload", { ignoreCache: true });
          },
          assert: async () => {
            await ctx.waitFor(
              `(() => {
                const overlay = document.querySelector('[data-testid="startup-logo-animation"]');
                return Boolean(overlay) && !overlay.className.includes('opacity-0');
              })()`,
              { timeoutMs: 3_000, label: "visible startup loader" },
            );
            const alt = await ctx.eval(
              "document.querySelector('[data-testid=\"startup-logo-animation\"] img')?.getAttribute('alt') ?? ''",
            );
            ctx.assert(/ipollowork loading/i.test(alt), `Expected the branded startup animation, got ${JSON.stringify(alt)}.`);
          },
          screenshot: { name: "startup-loader-visible", requireText: ["Loading"] },
        });

        await ctx.waitFor(
          "!document.querySelector('[data-testid=\"startup-logo-animation\"]')",
          { timeoutMs: 30_000, label: "startup loader dismissed" },
        );
      },
    },
    {
      name: "The signed-in Memory panel loads without a missing-route error",
      run: async (ctx) => {
        await ctx.prove("The Memory panel loads its personal Cloud memory list without a 404", {
          voiceover: vo[1],
          action: async () => {
            await ctx.navigateHash("/settings/memory");
            await ctx.expectHashIncludes("/settings/memory");
          },
          assert: async () => {
            await ctx.waitFor(
              "document.body.innerText.includes('还没有记忆') || document.body.innerText.includes('No memories yet') || Boolean(document.querySelector('[aria-label*=delete], [aria-label*=删除]'))",
              { timeoutMs: 15_000, label: "memory content or empty state" },
            );
            await ctx.expectNoText("Request failed with 404");
          },
          screenshot: {
            name: "memory-panel-loaded",
            rejectText: ["Request failed with 404"],
            hashIncludes: "/settings/memory",
          },
        });
      },
    },
  ],
};
