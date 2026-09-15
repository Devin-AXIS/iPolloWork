const DRAFT = "DSH 首条消息会话保留验证";
const EDITOR_SELECTOR = '[contenteditable="true"][data-lexical-editor="true"]';

async function workspaceIds(ctx) {
  return await ctx.eval(`(async () => {
    const port = localStorage.getItem("ipollowork.server.port");
    const token = localStorage.getItem("ipollowork.server.token");
    if (!port || !token) return { error: "missing local server connection" };
    const response = await fetch("http://127.0.0.1:" + port + "/workspaces", {
      headers: { Authorization: "Bearer " + token },
    });
    const payload = await response.json();
    const workspaces = Array.isArray(payload) ? payload : payload.workspaces ?? [];
    return {
      dsh: workspaces.find((workspace) => workspace.engineId === "deepseek-harness")?.id,
      port,
      token,
    };
  })()`, { awaitPromise: true });
}

async function selectAvailableModel(ctx) {
  const trigger = `Array.from(document.querySelectorAll("button"))
    .find((button) => button.getClientRects().length > 0
      && !button.disabled
      && /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""))`;
  await ctx.waitFor(`Boolean(${trigger})`, { timeoutMs: 45_000, label: "DSH model trigger" });
  await ctx.eval(`(${trigger})?.click()`);
  await ctx.waitForText("切换模型", { timeoutMs: 10_000 });
  await ctx.eval(`(() => {
    const entry = Array.from(document.querySelectorAll("button"))
      .filter((button) => button.textContent?.includes("切换模型")
        && !/切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""))
      .at(-1);
    entry?.click();
    return Boolean(entry);
  })()`);
  await ctx.waitFor(`Array.from(document.querySelectorAll('[data-slot="command-item"]'))
    .some((item) => !item.hasAttribute("data-disabled"))`, {
    timeoutMs: 30_000,
    label: "enabled account model",
  });
  await ctx.eval(`(() => {
    const item = Array.from(document.querySelectorAll('[data-slot="command-item"]'))
      .find((candidate) => !candidate.hasAttribute("data-disabled"));
    item?.setAttribute("data-fraimz-dsh-model", "true");
    return Boolean(item);
  })()`);
  await ctx.trustedClick('[data-fraimz-dsh-model="true"]');
}

export default {
  id: "dsh-initial-session-persist",
  title: "DSH first send preserves one sidebar session",
  kind: "user-facing",
  steps: [{
    name: "Send the first DSH task with staged mode and access settings",
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
        timeoutMs: 60_000,
        label: "iPolloWork control API",
      });
      const ids = await workspaceIds(ctx);
      ctx.assert(!ids.error && Boolean(ids.dsh), ids.error ?? "A DSH workspace is required.");

      try {
        await ctx.prove("The first DSH send starts once and remains in the sidebar", {
          voiceover: "发送第一条消息后，新会话立即出现在左侧，并正常进入处理状态。",
          action: async () => {
            await ctx.navigateHash(`/workspace/${ids.dsh}/session`);
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=initial-project-task-starter]'))", {
              timeoutMs: 45_000,
              label: "DSH new-task starter",
            });
            await selectAvailableModel(ctx);

            const workModeTrigger = `Array.from(document.querySelectorAll('button'))
              .find((button) => button.getClientRects().length > 0
                && /^(工作模式|Work mode):/.test(button.getAttribute('aria-label') ?? ''))`;
            await ctx.eval(`(${workModeTrigger})?.click()`);
            await ctx.waitFor("Boolean(document.querySelector('[data-work-mode-option=cordis]'))", {
              timeoutMs: 15_000,
              label: "DSH Cordis mode",
            });
            await ctx.trustedClick('button[data-work-mode-option="cordis"]');

            const accessTrigger = `Array.from(document.querySelectorAll('button'))
              .find((button) => button.getClientRects().length > 0
                && /^(权限|Access):/.test(button.getAttribute('aria-label') ?? ''))`;
            await ctx.eval(`(${accessTrigger})?.click()`);
            await ctx.waitFor("Boolean(document.querySelector('[data-access-mode-option=read-only]'))", {
              timeoutMs: 15_000,
              label: "DSH read-only access",
            });
            await ctx.trustedClick('button[data-access-mode-option="read-only"]');

            await ctx.eval(`(() => {
              window.__fraimzDshInitialOriginalFetch = window.fetch;
              window.__fraimzDshInitialCalls = [];
              window.fetch = async (input, init) => {
                const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
                let body = null;
                try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch {}
                if (url.includes("/engine/deepseek-harness/rpc")) {
                  window.__fraimzDshInitialCalls.push({ kind: "rpc", method: body?.method ?? "" });
                }
                if (url.includes("/engine/deepseek-harness/prompt")) {
                  const content = Array.isArray(body?.payload?.content)
                    ? body.payload.content.map((part) => part?.text ?? "").join("\\n")
                    : "";
                  window.__fraimzDshInitialCalls.push({ kind: "prompt", content });
                  if (content.includes(${JSON.stringify(DRAFT)})) return Response.json({ ok: true });
                }
                return window.__fraimzDshInitialOriginalFetch(input, init);
              };
              return true;
            })()`);

            await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(EDITOR_SELECTOR)}))`, {
              timeoutMs: 15_000,
              label: "DSH starter editor",
            });
            await ctx.eval(`document.querySelector(${JSON.stringify(EDITOR_SELECTOR)})?.focus()`);
            await ctx.client.send("Input.insertText", { text: DRAFT });
            await ctx.waitFor(`document.querySelector(${JSON.stringify(EDITOR_SELECTOR)})?.innerText.trim() === ${JSON.stringify(DRAFT)}`, {
              timeoutMs: 10_000,
              label: "DSH initial draft",
            });
            await ctx.waitFor(`(() => {
              const submit = document.querySelector('button[title="Run task"], button[title="运行任务"]');
              if (!submit || submit.disabled) return false;
              submit.click();
              return true;
            })()`, { timeoutMs: 10_000, label: "submit DSH initial task" });

            await ctx.waitFor(`Boolean(location.hash.match(/\\/session\\/([^/?]+)/)?.[1])`, {
              timeoutMs: 45_000,
              label: "new DSH session route",
            });
            await ctx.eval(`(() => {
              const sessionId = location.hash.match(/\\/session\\/([^/?]+)/)?.[1] ?? "";
              sessionStorage.setItem("fraimz-dsh-initial-session-id", sessionId);
              return sessionId;
            })()`);
            await ctx.waitFor(`Boolean(document.querySelector('[data-sidebar=menu-sub-button][data-active]'))`, {
              timeoutMs: 45_000,
              label: "new DSH sidebar session",
            });
            await ctx.waitFor(`(() => {
              const calls = window.__fraimzDshInitialCalls ?? [];
              const mode = calls.findIndex((call) => call.kind === "rpc" && call.method === "agentPreset.select");
              const permission = calls.findIndex((call) => call.kind === "rpc" && call.method === "commands/execute");
              const prompt = calls.findIndex((call) => call.kind === "prompt" && call.content.includes(${JSON.stringify(DRAFT)}));
              return mode >= 0 && permission > mode && prompt > permission;
            })()`, { timeoutMs: 30_000, label: "ordered DSH session startup" });
          },
          assert: async () => {
            const state = await ctx.eval(`(async () => {
              await new Promise((resolve) => setTimeout(resolve, 1500));
              const sessionId = sessionStorage.getItem("fraimz-dsh-initial-session-id") ?? "";
              const response = await fetch("http://127.0.0.1:${ids.port}/workspace/${ids.dsh}/sessions", {
                headers: { Authorization: "Bearer ${ids.token}" },
              });
              const payload = await response.json();
              return {
                sessionId,
                persisted: Array.isArray(payload.items) && payload.items.some((session) => session.id === sessionId),
                selectedSidebarText: document.querySelector('[data-sidebar=menu-sub-button][data-active]')?.textContent?.trim() ?? "",
                pageText: document.body.innerText,
              };
            })()`, { awaitPromise: true });
            ctx.assert(Boolean(state.sessionId), "The new DSH session id was not captured.");
            ctx.assert(state.persisted, "The new DSH session was absent from the server session list.");
            ctx.assert(Boolean(state.selectedSidebarText), "The new DSH session was absent from the sidebar.");
            ctx.assert(!state.pageText.includes("has already started; its agent preset is fixed"), "The DSH preset ordering error is still visible.");
          },
          screenshot: {
            name: "dsh-first-session-kept-in-sidebar",
            requireText: [DRAFT],
            rejectText: ["/permission read-only", "has already started; its agent preset is fixed", "DeepSeek Harness returned HTTP 404"],
          },
        });
      } finally {
        await ctx.eval(`(async () => {
          if (window.__fraimzDshInitialOriginalFetch) {
            window.fetch = window.__fraimzDshInitialOriginalFetch;
          }
          const sessionId = sessionStorage.getItem("fraimz-dsh-initial-session-id") ?? "";
          if (sessionId) {
            await fetch("http://127.0.0.1:${ids.port}/workspace/${ids.dsh}/sessions/" + encodeURIComponent(sessionId), {
              method: "DELETE",
              headers: { Authorization: "Bearer ${ids.token}" },
            }).catch(() => undefined);
          }
          delete window.__fraimzDshInitialOriginalFetch;
          delete window.__fraimzDshInitialCalls;
          sessionStorage.removeItem("fraimz-dsh-initial-session-id");
          return true;
        })()`, { awaitPromise: true });
      }
    },
  }],
};
