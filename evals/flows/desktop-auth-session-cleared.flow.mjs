import { createServer } from "node:http";

const voiceover = "退出登录会同时清除 iPolloWork 专用登录窗口的会话，下一次登录会重新要求认证。";

function startAuthFixture() {
  const server = createServer((request, response) => {
    const cookie = request.headers.cookie ?? "";
    const remembered = cookie.includes("ipollowork_auth_probe=remembered");
    if (request.url?.startsWith("/seed")) {
      if (request.url === "/seed") {
        response.writeHead(302, {
          location: "/remembered",
          "set-cookie": "ipollowork_auth_probe=remembered; Path=/; SameSite=Lax",
        });
        response.end();
        return;
      }
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <title>iPolloWork 登录验证</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #f6f7f9; color: #121417; }
      main { width: min(420px, calc(100% - 48px)); margin: 90px auto; padding: 34px; border: 1px solid #e4e7ec; border-radius: 22px; background: #fff; box-shadow: 0 24px 70px #1720331c; }
      .mark { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 13px; background: #111; color: #fff; font-weight: 800; }
      h1 { margin: 24px 0 10px; font-size: 26px; letter-spacing: -.03em; }
      p { margin: 0; color: #5d6675; line-height: 1.6; }
      button { width: 100%; margin-top: 26px; padding: 13px 16px; border: 0; border-radius: 12px; background: #111; color: #fff; font: inherit; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <div class="mark">iP</div>
      <h1>${remembered ? "Cached account reused" : "Fresh sign-in required"}</h1>
      <p>${remembered ? "The previous authentication session is still available." : "The previous account session is gone. Choose an account and authenticate again."}</p>
      <button type="button">Continue with another account</button>
    </main>
  </body>
</html>`);
  });
  server.unref();

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Authentication fixture did not bind a port."));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function openAuthWindow(ctx, url, label) {
  const origin = new URL(url).origin;
  const popup = ctx.switchToNewTab({
    match: (target) => String(target.url ?? "").startsWith(origin),
    timeoutMs: 20_000,
    label,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const result = await ctx.eval(
    `window.__IPOLLOWORK_ELECTRON__.shell.openAuth(${JSON.stringify(url)})`,
    { awaitPromise: true },
  );
  ctx.assert(result?.ok !== false, `Could not open the isolated auth window: ${result?.error ?? "unknown error"}`);
  await popup;
}

async function closeAuthWindow(ctx) {
  await ctx.eval("location.href = 'ipollowork-auth-window://close'");
  await ctx.switchBack();
}

export default {
  id: "desktop-auth-session-cleared",
  title: "Desktop sign-out clears the isolated authentication session",
  kind: "user-facing",
  steps: [
    {
      name: "Signing out removes the remembered browser session",
      run: async (ctx) => {
        await ctx.waitFor(
          "Boolean(window.__ipolloworkControl) && Boolean(window.__IPOLLOWORK_ELECTRON__?.shell?.openAuth) && Boolean(window.__IPOLLOWORK_ELECTRON__?.shell?.clearAuthSession)",
          { timeoutMs: 60_000, label: "desktop authentication bridge" },
        );
        await ctx.eval("window.__IPOLLOWORK_ELECTRON__.shell.clearAuthSession()", {
          awaitPromise: true,
        });
        const fixture = await startAuthFixture();

        await ctx.prove("After sign-out, reopening iPolloWork authentication requires a fresh login", {
          voiceover,
          action: async () => {
            await openAuthWindow(ctx, `${fixture.baseUrl}/seed`, "remembered authentication fixture");
            await ctx.expectText("Cached account reused");
            await closeAuthWindow(ctx);

            const cleared = await ctx.eval(
              "window.__IPOLLOWORK_ELECTRON__.shell.clearAuthSession()",
              { awaitPromise: true },
            );
            ctx.assert(cleared?.ok === true, `Authentication session clear failed: ${cleared?.error ?? "unknown error"}`);

            await openAuthWindow(ctx, `${fixture.baseUrl}/check`, "fresh authentication fixture");
          },
          assert: async () => {
            await ctx.expectText("Fresh sign-in required");
            await ctx.expectNoText("Cached account reused");
          },
          screenshot: {
            name: "fresh-sign-in-required",
            requireText: ["Fresh sign-in required", "Continue with another account"],
            rejectText: ["Cached account reused"],
          },
        });

        await closeAuthWindow(ctx);
        await fixture.close();
      },
    },
  ],
};
