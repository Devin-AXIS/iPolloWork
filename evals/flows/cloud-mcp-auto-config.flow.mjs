/**
 * After cloud sign-in, the Den cloud MCP ("iPolloWalk Cloud Control") is
 * auto-configured with a first-party org-scoped token: no browser OAuth,
 * entry is hidden by default until Show hidden reveals it, sync marker
 * persisted.
 *
 * Requires the programmatic runner (evals/runner) and a reachable Den API:
 * - IPOLLOWALK_EVAL_DEN_API_URL    Den API base, e.g. http://127.0.0.1:8790
 * - IPOLLOWALK_EVAL_DEN_TOKEN      Bearer session token for a Den account
 *
 * The app under test must be bootstrapped against the same Den control
 * plane (desktop-bootstrap.json) and signed out at start, or already signed
 * in to the same account.
 */

const revealHidden = async (ctx) => {
  const showing = await ctx.eval("document.body.innerText.includes('Showing hidden')");
  if (!showing) await ctx.clickText("Show hidden", { timeoutMs: 30_000 });
};

export default {
  id: "cloud-mcp-auto-config",
  title: "Cloud MCP auto-configures with first-party token on sign-in",
  spec: "evals/cloud-auth-flows.md",
  requiredEnv: ["IPOLLOWALK_EVAL_DEN_API_URL", "IPOLLOWALK_EVAL_DEN_TOKEN"],
  steps: [
    {
      name: "App booted",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipollowalkControl)", { timeoutMs: 60_000 });
      },
    },
    {
      name: "Sign in via desktop handoff (skipped when already signed in)",
      run: async (ctx) => {
        const signedIn = await ctx.eval(
          "Boolean((localStorage.getItem('ipollowalk.den.authToken') ?? '').trim())",
        );
        if (signedIn) {
          ctx.log("Already signed in; reusing session.");
          return;
        }

        const apiBase = ctx.env.IPOLLOWALK_EVAL_DEN_API_URL.trim().replace(/\/+$/, "");
        const response = await fetch(`${apiBase}/v1/auth/desktop-handoff`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${ctx.env.IPOLLOWALK_EVAL_DEN_TOKEN.trim()}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ desktopScheme: "ipollowalk" }),
        });
        ctx.assert(response.ok, `Handoff create failed: ${response.status}`);
        const payload = await response.json();

        await ctx.navigateHash("/settings/cloud-account");
        await ctx.clickText("Paste sign-in code", { timeoutMs: 30_000 });
        await ctx.fill("#den-signin-link", payload.ipollowalkUrl);
        await ctx.clickText("Finish sign-in");
        await ctx.waitFor(
          "Boolean((localStorage.getItem('ipollowalk.den.authToken') ?? '').trim())",
          { timeoutMs: 30_000, label: "persisted den auth token" },
        );
        // Post-sign-in org onboarding may appear; drive through it best-effort.
        await ctx.clickText("Continue with organization", { timeoutMs: 10_000 }).catch(() => {});
        await ctx.clickText("Continue to workspace", { timeoutMs: 10_000 }).catch(() => {});
      },
    },
    {
      name: "Active organization resolves",
      run: async (ctx) => {
        await ctx.waitFor(
          "Boolean((localStorage.getItem('ipollowalk.den.activeOrgId') ?? '').trim())",
          { timeoutMs: 60_000, label: "active org" },
        );
      },
    },
    {
      name: "Cloud MCP auto-config marker is written",
      run: async (ctx) => {
        await ctx.waitFor(
          "Boolean(localStorage.getItem('ipollowalk.den.mcp.sync'))",
          { timeoutMs: 120_000, label: "ipollowalk.den.mcp.sync marker" },
        );
        ctx.log(`marker: ${await ctx.eval("localStorage.getItem('ipollowalk.den.mcp.sync')")}`);
      },
    },
    {
      name: "iPolloWalk Cloud Control is hidden by default and revealed as a configured app",
      run: async (ctx) => {
        await ctx.navigateHash("/settings/extensions/mcp");
        await ctx.expectHashIncludes("/settings/extensions/mcp");
        await ctx.waitForText("Add Custom App", { timeoutMs: 30_000 });
        await ctx.expectNoText("iPolloWalk Cloud Control");
        await revealHidden(ctx);
        await ctx.expectText("iPolloWalk Cloud Control", { timeoutMs: 30_000 });
        await ctx.screenshot("cloud-mcp-configured", {
          claim: "iPolloWalk Cloud Control is auto-configured while hidden by default, then appears after Show hidden.",
          voiceover: "After signing in to iPolloWalk Cloud the connection is already configured and enabled, and it only shows up once the user reveals hidden extensions.",
          requireText: ["iPolloWalk Cloud Control", "Showing hidden"],
          rejectText: ["Something went wrong"],
          hashIncludes: "/settings/extensions/mcp",
        });
      },
    },
  ],
};
