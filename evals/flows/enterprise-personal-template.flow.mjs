import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("enterprise-personal-template");

let enterpriseScope = "";
let createdSessionId = "";

function clickButton(pattern, root = "document") {
  return `(() => {
    const scope = ${root};
    const button = Array.from(scope.querySelectorAll("button")).find((candidate) =>
      ${pattern}.test((candidate.textContent || "").replace(/\\s+/g, " ").trim())
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`;
}

async function ensureEnterprise(ctx) {
  const connection = await ctx.eval(`(() => {
    try {
      const items = JSON.parse(localStorage.getItem("ipollowork.enterprise-connections.v1") || "[]");
      const first = items[0];
      return first ? { id: first.id, name: first.name, shortName: first.shortName || first.name } : null;
    } catch { return null; }
  })()`);
  ctx.assert(Boolean(connection?.id), "Expected an existing Enterprise connection.");
  enterpriseScope = `enterprise:${connection.id}`;

  if (await ctx.eval(`localStorage.getItem("ipollowork.work-context.v1") !== ${JSON.stringify(enterpriseScope)}`)) {
    await ctx.navigateHash("/settings/cloud-account");
    await ctx.waitFor(
      `document.body.innerText.includes("工作身份") || document.body.innerText.includes("Work identity")`,
      { timeoutMs: 30_000, label: "Work identity selector" },
    );
    const clicked = await ctx.eval(clickButton(`/${connection.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/u`));
    ctx.assert(clicked === true, "Expected the connected Enterprise identity button.");
    await ctx.waitFor(
      `localStorage.getItem("ipollowork.work-context.v1") === ${JSON.stringify(enterpriseScope)}`,
      { timeoutMs: 30_000, label: "Enterprise context active" },
    );
  }

  await ctx.navigateHash("/session");
  await ctx.waitFor(`location.hash.includes("/session")`, { timeoutMs: 30_000, label: "Enterprise chat route" });
  await ctx.waitFor(`!document.querySelector('[data-testid="startup-logo-animation"]')`, {
    timeoutMs: 30_000,
    label: "Enterprise route ready",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const dialogCount = await ctx.eval(`document.querySelectorAll('[role="dialog"]').length`);
    if (!dialogCount) break;
    const closed = await ctx.eval(`(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      const dialog = dialogs.at(-1);
      const closeButton = dialog && Array.from(dialog.querySelectorAll("button")).find((button) =>
        /^(?:关闭|Close)$/u.test((button.textContent || "").trim())
      );
      if (!closeButton) return false;
      closeButton.click();
      return true;
    })()`);
    ctx.assert(closed === true, "Expected the previous template dialog to be closable.");
    await ctx.waitFor(`document.querySelectorAll('[role="dialog"]').length < ${dialogCount}`, {
      timeoutMs: 10_000,
      label: "Previous template dialog closed",
    });
  }
  ctx.assert(await ctx.eval(`document.querySelectorAll('[role="dialog"]').length`) === 0, "Expected no stale template dialogs.");
}

export default {
  id: "enterprise-personal-template",
  title: "Personal templates launch correctly inside an Enterprise work context",
  kind: "user-facing",
  spec: "evals/voiceovers/enterprise-personal-template.md",
  steps: [
    {
      name: "Setup",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl && window.__IPOLLOWORK_ELECTRON__?.invokeDesktop)", {
          timeoutMs: 60_000,
          label: "desktop app ready",
        });
        await ensureEnterprise(ctx);
      },
    },
    {
      name: "Personal template launches in Enterprise",
      run: async (ctx) => {
        await ctx.prove("An installed Personal template creates successfully inside the active Enterprise workspace", {
          voiceover: vo[0],
          action: async () => {
            const previousSessionId = await ctx.eval(`location.hash.match(/\\/session\\/(ses_[A-Za-z0-9]+)/)?.[1] || ""`);
            ctx.log(`previous Enterprise session: ${previousSessionId || "none"}`);
            const templatesClicked = await ctx.eval(clickButton("/^(?:模版|Templates)$/u"));
            ctx.assert(templatesClicked === true, "Expected the Templates button.");
            await ctx.waitFor(`Boolean(document.querySelector('[role="dialog"]'))`, {
              timeoutMs: 30_000,
              label: "Templates dialog",
            });
            const builtInClicked = await ctx.eval(clickButton("/^(?:内置|Built-in)$/u", "document.querySelector('[role=\\\"dialog\\\"]')"));
            ctx.assert(builtInClicked === true, "Expected the Built-in template source button.");
            await ctx.waitFor(
              `document.querySelector('[role="dialog"]')?.innerText.includes("Calm Mobile")`,
              { timeoutMs: 30_000, label: "Personal templates loaded" },
            );
            const previewed = await ctx.eval(`(() => {
              const card = Array.from(document.querySelectorAll('[role="dialog"] article')).find((item) =>
                (item.textContent || "").includes("Calm Mobile")
              );
              const button = card?.querySelector('button[aria-label*="Calm Mobile"]');
              if (!button || button.disabled) return false;
              button.click();
              return true;
            })()`);
            ctx.assert(previewed === true, "Expected the Calm Mobile App preview to open.");
            await ctx.waitFor(
              `(() => {
                const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
                const text = dialogs.at(-1)?.innerText || "";
                return text.includes("使用模板") || text.includes("Use template");
              })()`,
              { timeoutMs: 30_000, label: "Calm Mobile App preview" },
            );
            const used = await ctx.eval(clickButton("/^(?:使用模板|Use template)$/u", "Array.from(document.querySelectorAll('[role=\\\"dialog\\\"]')).at(-1)"));
            ctx.assert(used === true, "Expected Calm Mobile App to be usable from its preview.");
            await ctx.waitFor(
              `(() => {
                const sessionId = location.hash.match(/\\/session\\/(ses_[A-Za-z0-9]+)/)?.[1] || "";
                return Boolean(sessionId && sessionId !== ${JSON.stringify(previousSessionId)});
              })()`,
              { timeoutMs: 60_000, label: "template-backed Enterprise session" },
            );
            createdSessionId = await ctx.eval(`location.hash.match(/\\/session\\/(ses_[A-Za-z0-9]+)/)?.[1] || ""`);
            await ctx.waitFor(
              `document.body.innerText.includes("Calm Mobile") && !document.body.innerText.includes("Install this template before using it")`,
              { timeoutMs: 30_000, label: "Calm Mobile App materialized" },
            );
          },
          assert: async () => {
            const result = await ctx.eval(`(async () => {
              const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop("ipolloworkServerInfo");
              const token = (info.ownerToken || info.clientToken || "").trim();
              const workspaceId = location.hash.match(/\\/workspace\\/([^/]+)/)?.[1] || "";
              const sessionId = location.hash.match(/\\/session\\/(ses_[A-Za-z0-9]+)/)?.[1] || "";
              const response = await fetch(info.baseUrl + "/workspace/" + encodeURIComponent(workspaceId) + "/template-sessions/" + encodeURIComponent(sessionId), {
                headers: { Authorization: "Bearer " + token },
              });
              const body = await response.json().catch(() => ({}));
              return { status: response.status, templateId: body.manifest?.id || "", workspaceId, sessionId };
            })()`, { awaitPromise: true });
            ctx.assert(result.status === 200, `Expected a materialized template session: ${JSON.stringify(result)}.`);
            ctx.assert(result.templateId === "ipollowork.app-calm-mobile", `Unexpected template: ${JSON.stringify(result)}.`);
            ctx.assert(result.sessionId === createdSessionId, "The visible session must own the materialized template.");
            await ctx.expectNoText("OpenCode unavailable");
            await ctx.expectNoText("Install this template before using it");
          },
          screenshot: {
            name: "enterprise-personal-template-created",
            requireText: ["Calm Mobile"],
            rejectText: ["OpenCode unavailable", "Install this template before using it"],
            hashIncludes: "/session/",
          },
        });
      },
    },
    {
      name: "Cloud source remains isolated",
      run: async (ctx) => {
        await ctx.prove("Switching Explore from Built-in to Cloud hides bundled templates", {
          voiceover: vo[1],
          action: async () => {
            const templatesClicked = await ctx.eval(clickButton("/^(?:模版|Templates)$/u"));
            ctx.assert(templatesClicked === true, "Expected the Templates button.");
            await ctx.waitFor(`Boolean(document.querySelector('[role="dialog"]'))`, {
              timeoutMs: 30_000,
              label: "Templates dialog",
            });
            const cloudClicked = await ctx.eval(clickButton("/^Cloud$/u", "document.querySelector('[role=\\\"dialog\\\"]')"));
            ctx.assert(cloudClicked === true, "Expected the Cloud template source button.");
            await ctx.waitFor(
              `(() => {
                const dialog = document.querySelector('[role="dialog"]');
                return Boolean(dialog) && !dialog.innerText.includes("Calm Mobile") && !dialog.querySelector('[data-testid="template-catalog-loading"]');
              })()`,
              { timeoutMs: 30_000, label: "Cloud-only template source" },
            );
          },
          assert: async () => {
            const dialogText = await ctx.eval(`document.querySelector('[role="dialog"]')?.innerText || ""`);
            ctx.assert(!dialogText.includes("Calm Mobile"), "Built-in templates must not leak into the Cloud source.");
            ctx.assert(
              dialogText.includes("你的 Cloud 账号中暂无可用模板") || dialogText.includes("No templates are available in your Cloud account") || dialogText.includes("安装"),
              `Expected Cloud resources or an explicit empty state: ${JSON.stringify(dialogText.slice(0, 500))}.`,
            );
            await ctx.expectNoText("OpenCode unavailable");
            await ctx.expectNoText("Install this template before using it");
          },
          screenshot: {
            name: "cloud-template-source-isolated",
            requireText: ["模板来源", "Cloud"],
            rejectText: ["OpenCode unavailable", "Install this template before using it"],
          },
        });
      },
    },
  ],
};
