export default {
  id: "built-in-model-api-key",
  title: "Built-in models expose the API key connection required by the free catalog",
  kind: "user-facing",
  steps: [{
    name: "Open the built-in model API key form",
    run: async (ctx) => {
      await ctx.navigateHash("/settings/ai");
      await ctx.waitForText("连接提供商", { timeoutMs: 60_000 });

      await ctx.prove("The built-in model provider can be connected with a real API key", {
        voiceover: "内置模型现在可以直接进入密钥连接表单，免费模型不再依赖无效的公共占位凭证。",
        action: async () => {
          await ctx.clickText("连接提供商", { selector: "button", timeoutMs: 10_000 });
          await ctx.waitForText("Connect providers", { timeoutMs: 10_000 });
          await ctx.clickText("iPolloWork Built-in Models", { selector: "button", timeoutMs: 10_000 });
          await ctx.waitForText("An API key is currently required", { timeoutMs: 10_000 });
        },
        assert: async () => {
          await ctx.expectText("An API key is currently required", { timeoutMs: 1_000 });
          await ctx.expectText("Free models remain free after connection", { timeoutMs: 1_000 });
        },
        screenshot: {
          name: "built-in-models-provider-entry",
          requireText: ["iPolloWork Built-in Models"],
          hashIncludes: "/settings/ai",
        },
      });
    },
  }],
};
