/**
 * Smoke: the app boots, the automation control API is live, and a known route
 * renders real content.
 */
export default {
  id: "app-smoke",
  title: "App boots and renders a known route",
  kind: "user-facing",
  spec: "evals/react-session-flows.md",
  steps: [
    {
      name: "CDP target is the Electron app (or dev web build)",
      run: async (ctx) => {
        const userAgent = await ctx.eval("navigator.userAgent");
        ctx.assert(typeof userAgent === "string" && userAgent.length > 0, "No userAgent.");
        ctx.log(`userAgent: ${userAgent}`);
      },
    },
    {
      name: "Automation control API becomes available",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 30_000,
          label: "window.__ipolloworkControl",
        });
      },
    },
    {
      name: "App reports a known route",
      run: async (ctx) => {
        const route = await ctx.waitFor(
          "window.__ipolloworkControl.snapshot().route",
          { label: "control snapshot route" },
        );
        ctx.log(`route: ${JSON.stringify(route)}`);
      },
    },
    {
      name: "UI rendered meaningful content",
      run: async (ctx) => {
        await ctx.prove("The app finishes loading and displays its route without a blocking overlay", {
          voiceover: "应用启动后，加载遮罩消失，工作界面正常显示。",
          action: async () => {
            await ctx.waitFor(`
              document.body.innerText.trim().length > 40
              && !document.querySelector('[data-testid="startup-logo-animation"]')
              && !document.querySelector('[data-testid="session-loading-animation"]')
            `, { timeoutMs: 30_000, label: "rendered route without a loading overlay" });
          },
          assert: async () => {
            ctx.assert(
              !(await ctx.eval("Boolean(document.querySelector('vite-error-overlay'))")),
              "The renderer has no Vite compilation error overlay",
            );
          },
          screenshot: {
            name: "booted",
            hashIncludes: await ctx.eval("window.__ipolloworkControl.snapshot().route"),
          },
        });
      },
    },
  ],
};
