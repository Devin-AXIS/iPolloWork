export default {
  id: "cloud-legacy-http-registration",
  title: "旧版 iPolloWork 打开 Cloud 注册",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "i.ipollo.ai/register" },
  steps: [{
    name: "旧版 HTTP 注册入口",
    async run(ctx) {
      await ctx.prove("旧版 HTTP 注册入口打开 HTTPS 注册页并保留桌面回调", {
        voiceover: "从旧版 iPolloWork 打开注册，页面会自动转到 HTTPS，注册后仍能返回桌面应用。",
        action: () => ctx.client.send("Page.navigate", {
          url: "http://i.ipollo.ai/?mode=sign-up&desktopAuth=1&desktopScheme=ipollowork",
        }),
        assert: async () => {
          await ctx.waitFor(`location.origin === "https://i.ipollo.ai" &&
            location.pathname === "/register" &&
            new URLSearchParams(location.search).get("desktopAuth") === "1" &&
            new URLSearchParams(location.search).get("desktopScheme") === "ipollowork" &&
            Boolean(document.querySelector('input[type="email"]'))`);
        },
        screenshot: { name: "secure-registration", requireText: ["Create your iPolloWork account"] },
      });
    },
  }],
};
