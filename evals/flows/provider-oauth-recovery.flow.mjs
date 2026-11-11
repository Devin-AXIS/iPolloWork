const retryLabel = "重新授权";
const unconfirmed = "应用尚未确认这次授权";
const dialogButtons = '[role="dialog"] button:not(:disabled)';

export default {
  id: "provider-oauth-recovery",
  title: "Restart authorization after an unconfirmed browser callback",
  kind: "user-facing",
  preserveTheme: true,
  steps: [{
    name: "Restart OpenAI authorization from the recovery action",
    async run(ctx) {
      await ctx.waitFor("Boolean(window.__ipolloworkControl) && !document.querySelector('[data-testid=startup-logo-animation]')");
      ctx.assert(await ctx.eval("!document.querySelector('[role=dialog]')"), "Close the existing dialog before running this flow.");
      // Mount the real modal with synthetic callbacks so the proof does not
      // open a third-party sign-in page or write real provider credentials.
      await ctx.eval(`(async () => {
        const entry = await (await fetch("/src/index.react.tsx")).text();
        const reactUrl = entry.match(/"([^"]+\\/react\\.js\\?[^"]+)"/)?.[1];
        const domUrl = entry.match(/"([^"]+\\/react-dom_client\\.js\\?[^"]+)"/)?.[1];
        if (!reactUrl || !domUrl) throw new Error("The desktop Vite entry did not expose the React imports");
        const [{ default: React }, dom, { default: Modal }] = await Promise.all([
          import(reactUrl),
          import(domUrl),
          import("/src/react-app/domains/connections/provider-auth/provider-auth-modal.tsx"),
        ]);
        const element = document.createElement("div");
        document.body.append(element);
        const root = (dom.createRoot ?? dom.default.createRoot)(element);
        const fixture = { authorize: 0, callback: 0, readOnlyPolls: [] };
        window.__providerOAuthRecovery = { fixture, dispose: () => { root.unmount(); element.remove(); } };
        root.render(React.createElement(Modal, {
          open: true, loading: false, submitting: false, error: null,
          providers: [{ id: "openai", name: "OpenAI", env: [] }],
          connectedProviderIds: [],
          authMethods: { openai: [{ methodIndex: 0, type: "oauth", label: "ChatGPT Pro/Plus (browser)" }] },
          onSelect: async () => {
            fixture.authorize++;
            return { methodIndex: 0, authorization: { url: "", method: "auto", instructions: "" } };
          },
          onSubmitOAuth: async () => {
            fixture.callback++;
            return { connected: false, pending: true };
          },
          onRefreshProviders: async options => { fixture.readOnlyPolls.push(options?.skipSharedImport === true); },
          onClose: () => {},
        }));
        return true;
      })()`, { awaitPromise: true });
      try {
        await ctx.prove("An unconfirmed callback offers a fresh browser authorization", {
          voiceover: "应用确认不到浏览器授权时，会提示重新授权，点一下即可发起新的登录。",
          action: async () => {
            await ctx.clickText("OpenAI", { selector: dialogButtons });
            await ctx.clickText("ChatGPT Pro/Plus (browser)", { selector: dialogButtons });
            await ctx.waitForText(unconfirmed);
            await ctx.clickText(retryLabel, { selector: dialogButtons });
            await ctx.waitFor("window.__providerOAuthRecovery.fixture.callback === 2", { label: "fresh OAuth callback request" });
          },
          assert: async () => {
            const state = await ctx.eval("window.__providerOAuthRecovery.fixture");
            ctx.assert(state.authorize === 2 && state.callback === 2, "Each attempt starts a new authorization and requests its callback once.");
            ctx.assert(state.readOnlyPolls.length > 0 && state.readOnlyPolls.every(Boolean), "Authorization polling does not import credentials.");
          },
          screenshot: { name: "provider-oauth-retry", requireText: [unconfirmed, retryLabel] },
        });
      } finally {
        await ctx.eval("window.__providerOAuthRecovery.dispose(); delete window.__providerOAuthRecovery; true");
      }
    },
  }],
};
