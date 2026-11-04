export default {
  id: "offcn-provider-removal",
  title: "Retired Offcn is absent from provider connections while DeepSeek remains available",
  kind: "user-facing",
  steps: [{
    name: "Open provider connections and search for Offcn",
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000 });
      await ctx.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);
      await ctx.navigateHash("/settings/ai");
      await ctx.waitForText("连接提供商", { timeoutMs: 30_000 });
      await ctx.prove("Offcn cannot be connected or found, and the official DeepSeek provider remains available", {
        voiceover: "连接提供商中已移除 Offcn，搜索也不会出现，DeepSeek 官方服务仍可正常选择。",
        action: async () => {
          await ctx.clickText("连接提供商", { selector: "button" });
          await ctx.waitForText("Connect providers");
          await ctx.waitFor(`Boolean(document.querySelector('input[placeholder="Filter providers by name or ID"]'))`);
          await ctx.fill('input[placeholder="Filter providers by name or ID"]', "Offcn");
        },
        assert: async () => {
          const matchingRows = await ctx.eval(`Array.from(document.querySelectorAll('[role="dialog"] button'))
            .filter((button) => /offcn/i.test(button.innerText)).length`);
          ctx.assert(matchingRows === 0, "Searching for Offcn must return no provider rows.");
          await ctx.fill('input[placeholder="Filter providers by name or ID"]', "");
          await ctx.waitForText("DeepSeek");
          const providerText = await ctx.eval(`document.querySelector('[role="dialog"]').innerText`);
          ctx.assert(!/offcn/i.test(providerText), "Offcn must be absent from every provider group.");
          ctx.assert(providerText.includes("deepseek-official"), "The official DeepSeek connection must remain available.");
          await ctx.eval(`Array.from(document.querySelectorAll('[role="dialog"] button'))
            .find((button) => button.innerText.includes("deepseek-official"))?.scrollIntoView({ block: "center" }); true`);
        },
        screenshot: {
          name: "provider-connections-without-offcn",
          requireText: ["Connect providers", "DeepSeek"],
          rejectText: ["Offcn"],
        },
      });
    },
  }],
};
