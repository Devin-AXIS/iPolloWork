import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";

const requireFromApp = createRequire(new URL("../../apps/app/package.json", import.meta.url));
const JSZip = requireFromApp("jszip");

async function createTemplatePackage(templateId) {
  const archive = new JSZip();
  archive.file("manifest.json", JSON.stringify({
    schemaVersion: 1,
    id: templateId,
    version: "1.0.0",
    kind: "design",
    category: "site",
    subcategory: "brand",
    title: "企业品牌演示模板",
    description: "由当前企业发布的品牌网站模板。",
    cover: "cover.svg",
    entry: "entry.html",
    source: { name: "Fraimz Enterprise", license: "Proprietary" },
    designSystem: { tokenVersion: 1, editableGroups: ["theme", "typography"] },
    applyChecklist: ["替换企业品牌内容"],
    minimumAppVersion: "0.17.0",
  }));
  archive.file("entry.html", "<!doctype html><main><h1>企业品牌演示模板</h1></main>");
  archive.file("cover.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#eef2ff"/><text x="120" y="460" font-size="96">Enterprise</text></svg>');
  archive.file("LICENSE", "Enterprise use only");
  return archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function startEnterpriseFixture() {
  const fixtureSuffix = Date.now().toString(36);
  const enterpriseId = `ent_fraimz_${fixtureSuffix}`;
  const templateId = `enterprise.fraimz-brand-${fixtureSuffix}`;
  const resourceId = "40493b5a-d865-409d-9bc7-ecd58318d3ea";
  const bytes = await createTemplatePackage(templateId);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({ path: `${url.pathname}${url.search}`, authorization: request.headers.authorization ?? "" });
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "authorization, content-type");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname === "/.well-known/ipollo-enterprise") {
      const origin = `http://127.0.0.1:${server.address().port}`;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        serverId: enterpriseId,
        name: "Fraimz Enterprise",
        version: "0.1.0",
        origin,
        publicKeyFingerprint: null,
        authMode: "ipollo_oidc",
        capabilities: ["enterprise_manifest", "templates", "resource_downloads"],
      }));
      return;
    }
    if (url.pathname === "/api/v1/client-manifest") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        enterprise: {
          id: enterpriseId,
          name: "Fraimz Enterprise",
          shortName: "企业",
          logoUrl: null,
          accent: "blue",
        },
        features: { templates: true, templatePublishing: true, extensions: true, sessionSharing: false },
        labels: { templateSource: "企业", extensionSource: "企业" },
      }));
      return;
    }
    if (request.headers.authorization !== "Bearer fraimz-session") {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (url.pathname === "/api/v1/resources" && url.searchParams.get("type") === "template") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        items: [{
          id: resourceId,
          type: "template",
          slug: templateId,
          name: "企业品牌演示模板",
          description: "由当前企业发布的品牌网站模板。",
          category: "site",
          enterpriseCategory: "企业品牌",
          access: "all",
          featured: true,
          status: "published",
          sourceTemplateId: templateId,
          ownerMemberId: null,
          updatedAt: "2026-08-31T00:00:00.000Z",
          iconPath: null,
          latestVersion: {
            version: "1.0.0",
            digest,
            downloadPath: `/api/v1/resources/${resourceId}/versions/1.0.0/download`,
          },
        }],
        nextCursor: null,
      }));
      return;
    }
    if (url.pathname === `/api/v1/resources/${resourceId}/versions/1.0.0/download`) {
      response.writeHead(200, {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${templateId}-1.0.0.ipwp"`,
        "content-length": bytes.byteLength,
        "content-type": "application/vnd.ipollowork.package+zip",
        "x-ipollo-artifact-sha256": digest,
        "x-ipollo-resource-type": "template",
      });
      response.end(bytes);
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  server.unref();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Enterprise fixture did not bind a port.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    enterpriseId,
    templateId,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export default {
  id: "enterprise-template-market-source",
  title: "Enterprise templates appear beside Cloud templates",
  kind: "user-facing",
  steps: [{
    name: "Open the Enterprise template catalog",
    run: async (ctx) => {
      const fixture = await startEnterpriseFixture();
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
        timeoutMs: 60_000,
        label: "iPolloWork control API",
      });
      await ctx.eval(`(() => {
        for (const close of Array.from(document.querySelectorAll('[data-slot="dialog-close"]')).reverse()) {
          if (close.getClientRects().length > 0) close.click();
        }
        return true;
      })()`);
      await ctx.waitFor(`!Array.from(document.querySelectorAll('[role="dialog"]'))
        .some((dialog) => dialog.getClientRects().length > 0
          && dialog.innerText.includes("我的模板")
          && dialog.innerText.includes("探索"))`, {
        timeoutMs: 5_000,
        label: "closed stale template market dialog",
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const previousState = await ctx.eval(`(() => {
        const previous = {
          connections: localStorage.getItem("ipollowork.enterprise-connections.v1"),
          workContext: localStorage.getItem("ipollowork.work-context.v1"),
        };
        const connection = {
          id: ${JSON.stringify(fixture.enterpriseId)},
          name: "Fraimz Enterprise",
          shortName: "企业",
          origin: ${JSON.stringify(fixture.origin)},
          logoUrl: null,
          accent: "blue",
          authMode: "ipollo_oidc",
          membership: { id: "member-fraimz", role: "member" },
          session: { token: "fraimz-session", expiresAt: "2099-01-01T00:00:00.000Z" },
        };
        localStorage.setItem("ipollowork.enterprise-connections.v1", JSON.stringify([connection]));
        localStorage.setItem("ipollowork.work-context.v1", ${JSON.stringify(`enterprise:${fixture.enterpriseId}`)});
        window.dispatchEvent(new CustomEvent("ipollowork:enterprise-connections-changed"));
        return previous;
      })()`);
      try {
        await ctx.navigateHash("/session");
        await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
          .some((button) => button.textContent?.trim() === "模板")`, {
          timeoutMs: 10_000,
          label: "templates button",
        });

        await ctx.prove("Enterprise members can install a verified template and immediately use it", {
          voiceover: "加入企业后，可以在 Enterprise 模板目录安装企业发布的模板，安装完成后立即显示为可使用。",
          action: async () => {
            const templateButtonClicked = await ctx.eval(`(() => {
              const button = Array.from(document.querySelectorAll("button"))
                .find((element) => element.getClientRects().length > 0
                  && element.textContent?.trim() === "模板");
              if (!(button instanceof HTMLElement)) return false;
              button.click();
              return true;
            })()`);
            ctx.assert(templateButtonClicked, "The visible Templates navigation button could not be clicked.");
            await ctx.waitFor(`Array.from(document.querySelectorAll('[role="dialog"]'))
              .some((dialog) => dialog.getClientRects().length > 0
                && dialog.innerText.includes("我的模板")
                && dialog.innerText.includes("探索"))`, {
              timeoutMs: 10_000,
              label: "template market dialog",
            });
            const enterpriseTabClicked = await ctx.eval(`(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
                .find((element) => element.getClientRects().length > 0
                  && element.innerText.includes("我的模板")
                  && element.innerText.includes("探索"));
              const tab = dialog
                ? Array.from(dialog.querySelectorAll('[role="tab"]'))
                  .find((element) => element.textContent?.trim() === "企业")
                : null;
              if (!(tab instanceof HTMLElement)) return false;
              tab.click();
              return true;
            })()`);
            ctx.assert(enterpriseTabClicked, "The Enterprise template source tab could not be clicked.");
            try {
              await ctx.waitForText("企业品牌演示模板", { timeoutMs: 30_000 });
            } catch (error) {
              const dialogText = await ctx.eval(`(() => Array.from(document.querySelectorAll('[role="dialog"]'))
                .filter((element) => element.getClientRects().length > 0)
                .map((element) => element.innerText)
                .join("\n---\n"))()`);
              throw new Error(`${error instanceof Error ? error.message : String(error)}\nVisible dialogs: ${dialogText}\nEnterprise requests: ${JSON.stringify(fixture.requests)}`);
            }
            const installClicked = await ctx.eval(`(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
                .find((element) => element.getClientRects().length > 0
                  && element.innerText.includes("我的模板")
                  && element.innerText.includes("探索"));
              const button = dialog
                ? Array.from(dialog.querySelectorAll("button"))
                  .find((candidate) => {
                    if (candidate.textContent?.trim() !== "安装") return false;
                    let container = candidate.parentElement;
                    while (container && container !== dialog) {
                      if (container.innerText.includes("企业品牌演示模板")) return true;
                      container = container.parentElement;
                    }
                    return false;
                  })
                : null;
              if (!(button instanceof HTMLElement)) return false;
              button.click();
              return true;
            })()`);
            ctx.assert(installClicked, "The Enterprise template install action could not be clicked.");
            try {
              await ctx.waitFor(`Array.from(document.querySelectorAll('[role="dialog"]'))
                .filter((dialog) => dialog.getClientRects().length > 0
                  && dialog.innerText.includes("我的模板")
                  && dialog.innerText.includes("探索"))
                .some((dialog) => Array.from(dialog.querySelectorAll("button"))
                  .some((button) => {
                    if (button.textContent?.trim() !== "使用" || button.disabled) return false;
                    let container = button.parentElement;
                    while (container && container !== dialog) {
                      if (container.innerText.includes("企业品牌演示模板")) return true;
                      container = container.parentElement;
                    }
                    return false;
                  }))`, {
                timeoutMs: 30_000,
                label: "installed Enterprise template use action",
              });
            } catch (error) {
              const visibleText = await ctx.eval(`(() => document.body.innerText.slice(-4000))()`);
              throw new Error(`${error instanceof Error ? error.message : String(error)}\nVisible text: ${visibleText}\nEnterprise requests: ${JSON.stringify(fixture.requests)}`);
            }
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
                .find((element) => element.getClientRects().length > 0
                  && element.innerText.includes("我的模板")
                  && element.innerText.includes("探索"));
              const enterpriseTab = dialog
                ? Array.from(dialog.querySelectorAll('[role="tab"]'))
                  .find((element) => element.textContent?.trim() === "企业")
                : null;
              return {
                hasDialog: Boolean(dialog),
                hasCloudTab: Boolean(dialog?.innerText.includes("Cloud")),
                enterpriseSelected: enterpriseTab?.getAttribute("aria-selected") === "true",
                hasEnterpriseTemplate: Boolean(dialog?.innerText.includes("企业品牌演示模板")),
                hasUseAction: Array.from(dialog?.querySelectorAll("button") ?? [])
                  .some((button) => button.textContent?.trim() === "使用" && !button.disabled),
                hasError: Boolean(dialog?.querySelector('[role="alert"]')),
              };
            })()`);
            ctx.assert(state.hasDialog, "The template market dialog is not visible.");
            ctx.assert(state.hasCloudTab, "The Cloud source tab is missing.");
            ctx.assert(state.enterpriseSelected, "The Enterprise source tab is not selected.");
            ctx.assert(state.hasEnterpriseTemplate, "The Enterprise template catalog is empty.");
            ctx.assert(state.hasUseAction, "The installed Enterprise template is not usable.");
            ctx.assert(!state.hasError, "The Enterprise catalog rendered an error state.");
            ctx.assert(
              fixture.requests.some((request) => request.path === "/api/v1/resources?type=template&limit=50"
                && request.authorization === "Bearer fraimz-session"),
              "The Enterprise resource catalog did not use the documented session-authenticated endpoint.",
            );
            ctx.assert(
              fixture.requests.some((request) => request.path.includes("/versions/1.0.0/download")
                && request.authorization === "Bearer fraimz-session"),
              "The Enterprise template artifact was not downloaded with the member session.",
            );
          },
          screenshot: {
            name: "enterprise-template-installed",
            requireText: ["模板", "Cloud", "企业", "企业品牌演示模板", "使用"],
            rejectText: ["无法从当前企业服务器加载资源"],
          },
        });

        await ctx.prove("An installed Enterprise template opens the existing template application flow", {
          voiceover: "安装后的企业模板可以直接在当前 Enterprise 标签页点击使用，并进入与其他模板一致的应用流程。",
          action: async () => {
            const useClicked = await ctx.eval(`(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
                .find((element) => element.getClientRects().length > 0
                  && element.innerText.includes("我的模板")
                  && element.innerText.includes("探索"));
              const button = dialog
                ? Array.from(dialog.querySelectorAll("button"))
                  .find((element) => {
                    if (element.textContent?.trim() !== "使用" || element.disabled) return false;
                    let container = element.parentElement;
                    while (container && container !== dialog) {
                      if (container.innerText.includes("企业品牌演示模板")) return true;
                      container = container.parentElement;
                    }
                    return false;
                  })
                : null;
              if (!(button instanceof HTMLElement)) return false;
              button.click();
              return true;
            })()`);
            ctx.assert(useClicked, "The installed Enterprise template use action could not be clicked.");
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="template-apply-dialog"]'))`, {
              timeoutMs: 10_000,
              label: "Enterprise template application dialog",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const dialog = document.querySelector('[data-testid="template-apply-dialog"]');
              return {
                visible: Boolean(dialog && dialog.getClientRects().length > 0),
                hasTemplateTitle: Boolean(dialog?.innerText.includes("企业品牌演示模板")),
                hasCloseAction: Array.from(dialog?.querySelectorAll("button") ?? [])
                  .some((button) => button.getAttribute("aria-label") === "关闭"),
              };
            })()`);
            ctx.assert(state.visible, "The template application dialog is not visible.");
            ctx.assert(state.hasTemplateTitle, "The application flow lost the Enterprise template identity.");
            ctx.assert(state.hasCloseAction, "The template application dialog is not interactive.");
          },
          screenshot: {
            name: "enterprise-template-use-flow",
            requireText: ["企业品牌演示模板"],
            rejectText: ["模板不可用", "Template unavailable"],
          },
        });
      } finally {
        await ctx.eval(`(async () => {
          const route = window.__ipolloworkControl?.snapshot().route ?? "";
          const workspaceId = (route + " " + location.hash).match(/workspace\\/([^/]+)/)?.[1] ?? "";
          const templateRequest = performance.getEntriesByType("resource")
            .map((entry) => entry.name)
            .find((name) => name.includes("/workspace/") && name.includes("/templates"));
          const override = localStorage.getItem("ipollowork.server.urlOverride")?.trim() ?? "";
          const port = localStorage.getItem("ipollowork.server.port")?.trim() ?? "";
          const serverOrigin = templateRequest
            ? new URL(templateRequest).origin
            : override || (port ? "http://127.0.0.1:" + port : "");
          if (!workspaceId || !serverOrigin) return false;
          const token = localStorage.getItem("ipollowork.server.token")?.trim() ?? "";
          const hostToken = localStorage.getItem("ipollowork.server.hostToken")?.trim() ?? "";
          const headers = { "X-iPolloWork-Resource-Scope": ${JSON.stringify(`enterprise:${fixture.enterpriseId}`)} };
          if (token) headers.Authorization = "Bearer " + token;
          if (hostToken) headers["X-iPolloWork-Host-Token"] = hostToken;
          const catalogUrl = serverOrigin + "/workspace/" + encodeURIComponent(workspaceId) + "/templates";
          const catalogResponse = await fetch(catalogUrl, { headers });
          if (!catalogResponse.ok) return false;
          const catalog = await catalogResponse.json();
          const fixtureIds = Array.isArray(catalog?.items)
            ? catalog.items
              .map((item) => item?.manifest?.id)
              .filter((id) => typeof id === "string" && id.startsWith("enterprise.fraimz-brand-"))
            : [];
          const results = await Promise.all(fixtureIds.map((templateId) => fetch(
            catalogUrl + "/" + encodeURIComponent(templateId),
            { method: "DELETE", headers },
          )));
          return results.every((response) => response.ok);
        })()`).catch(() => false);
        await ctx.eval(`(() => {
          const previous = ${JSON.stringify(previousState)};
          if (previous.connections === null) localStorage.removeItem("ipollowork.enterprise-connections.v1");
          else localStorage.setItem("ipollowork.enterprise-connections.v1", previous.connections);
          if (previous.workContext === null) localStorage.removeItem("ipollowork.work-context.v1");
          else localStorage.setItem("ipollowork.work-context.v1", previous.workContext);
          window.dispatchEvent(new CustomEvent("ipollowork:enterprise-connections-changed"));
          return true;
        })()`);
        await fixture.close();
      }
    },
  }],
};
