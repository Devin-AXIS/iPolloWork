import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
const vo = await loadVoiceoverParagraphs("ipwp-template-export");
const runKey = Date.now().toString(36);
const exportTitle = `Fraimz Export Only Video ${runKey}`, templateTitle = `Fraimz Saved Video ${runKey}`;
const invalidPackageName = `broken-video-${runKey}.ipwp`;
const state = {
  workspaceId: "",
  sessionId: "",
  sourcePath: "",
  sourceEntry: "",
  template: null,
  packageName: "",
  localPackageName: "",
  localPackageDirectory: "",
  localPackagePath: "",
  importedTemplate: null,
  officialTemplate: null,
};
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function serverRequest(ctx, path, { method = "GET", body, binary = false, tolerate = false } = {}) {
  const result = await ctx.eval(`(async () => {
    const baseUrl = localStorage.getItem("ipollowork.server.urlOverride")
      || localStorage.getItem("ipollowork.server.active");
    const headers = {
      Authorization: "Bearer " + localStorage.getItem("ipollowork.server.token"),
      "X-iPolloWork-Host-Token": localStorage.getItem("ipollowork.server.hostToken"),
      ...(${JSON.stringify(body)} !== undefined ? { "Content-Type": "application/json" } : {}),
    };
    const response = await fetch(baseUrl + ${JSON.stringify(path)}, {
      method: ${JSON.stringify(method)},
      headers,
      ${body === undefined ? "" : `body: JSON.stringify(${JSON.stringify(body)}),`}
    });
    const contentType = response.headers.get("content-type");
    const disposition = response.headers.get("content-disposition");
    if (${JSON.stringify(binary)}) {
      const bytes = [...new Uint8Array(await response.arrayBuffer())];
      return { ok: response.ok, status: response.status, contentType, disposition, bytes };
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: response.ok, status: response.status, contentType, disposition, data };
  })()`, { awaitPromise: true });
  if (!tolerate) ctx.assert(result?.ok, `${method} ${path} failed: ${result?.status} ${JSON.stringify(result?.data)}`);
  return result;
}
async function eventually(callback, { timeoutMs = 60_000, label = "condition" } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await pause(300);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}
async function clickExactText(ctx, text, selector = "button") {
  return ctx.waitFor(`(() => {
    const direct = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((node) => node.textContent?.trim() === ${JSON.stringify(text)});
    const leaf = [...document.querySelectorAll(${JSON.stringify(`${selector} *`)})]
      .find((node) => node.children.length === 0 && node.textContent?.trim() === ${JSON.stringify(text)});
    const target = direct ?? leaf?.closest(${JSON.stringify(selector)});
    if (!target || target.disabled) return false;
    target.scrollIntoView({ block: "center" });
    target.click();
    return true;
  })()`, { timeoutMs: 30_000, label: `exact control ${text}` });
}
async function setChinese(ctx) {
  const changed = await ctx.eval(`(() => {
    if (localStorage.getItem("ipollowork.language") === "zh") return false;
    localStorage.setItem("ipollowork.language", "zh");
    return true;
  })()`);
  if (changed) {
    await ctx.eval("location.reload()");
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "Chinese app reload" });
  }
}
async function resetApp(ctx) {
  await ctx.eval("location.reload()");
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "app control after reload" });
  await ctx.waitFor("document.body.innerText.trim().length > 40", { timeoutMs: 60_000, label: "rendered application" });
}
async function createVideoAuthoringSession(ctx) {
  await ctx.waitFor(`window.__ipolloworkControl.listActions()
    .some((action) => action.id === "session.create_task" && !action.disabled)`, {
    timeoutMs: 60_000,
    label: "enabled create task control",
  });
  const before = await ctx.eval("location.hash");
  await ctx.control("session.create_task");
  const hash = await ctx.waitFor(`location.hash !== ${JSON.stringify(before)} && /\\/session\\//.test(location.hash) && location.hash`, {
    timeoutMs: 60_000,
    label: "new task route",
  });
  state.sessionId = hash.match(/\/session\/([^/?#]+)/)?.[1] ?? "";
  ctx.assert(Boolean(state.sessionId), "Could not resolve the new task id.");
  await serverRequest(ctx, `/workspace/${state.workspaceId}/templates/authoring-sessions`, {
    method: "POST",
    body: { sessionId: state.sessionId, category: "video" },
  });
  await resetApp(ctx);
  await ctx.navigateHash(`/workspace/${state.workspaceId}/session/${state.sessionId}`);
  await ctx.waitFor(`[...document.querySelectorAll("iframe")]
    .some((frame) => frame.title.includes("HyperFrames") && frame.dataset.loaded === "true")`, {
    timeoutMs: 90_000,
    label: "Video Studio authoring surface",
  });
}
async function openSaveDialog(ctx) {
  await ctx.waitFor(`(() => {
    const button = [...document.querySelectorAll("button")]
      .find((item) => item.getAttribute("aria-label") === "更多 Video 操作" && !item.disabled);
    if (!button) return false;
    button.click();
    return true;
  })()`, { timeoutMs: 60_000, label: "Video template actions" });
  await ctx.clickText("保存为作品模板", { selector: "[role=menuitem]", timeoutMs: 30_000 });
  await ctx.expectText("验证当前作品，然后保存到“我的模板”或导出为本地 .ipwp 文件。", { timeoutMs: 30_000 });
}
async function openTemplateMarket(ctx) {
  if (await ctx.eval("Boolean(document.querySelector('[role=dialog] input[placeholder=\"搜索模板\"]'))")) return;
  await clickExactText(ctx, "模版");
  await ctx.waitFor("document.querySelector('[role=dialog]')?.innerText.includes('我的模板')", {
    timeoutMs: 30_000,
    label: "personal template market",
  });
}
async function closeTemplateMarket(ctx) {
  const closed = await ctx.eval(`(() => {
    const dialog = [...document.querySelectorAll('[role=dialog]')].find((item) => item.innerText.includes("导入 .ipwp 或 .ipwt"));
    const button = dialog?.querySelector('[data-slot="dialog-close"]');
    button?.click();
    return Boolean(button);
  })()`);
  if (!closed) return;
  await ctx.waitFor(`![...document.querySelectorAll('[role=dialog]')]
    .some((dialog) => dialog.innerText.includes("导入 .ipwp 或 .ipwt"))`, {
    timeoutMs: 10_000, label: "template market to close",
  });
}
async function searchMarket(ctx, value) {
  await openTemplateMarket(ctx);
  await ctx.fill('input[placeholder="搜索模板"]', value);
  await pause(300);
}
async function openTemplateActions(ctx, title) {
  await ctx.waitFor(`(() => {
    const button = [...document.querySelectorAll("button")]
      .find((item) => item.getAttribute("aria-label") === ${JSON.stringify(`${title} 更多操作`)} && !item.disabled);
    if (!button) return false;
    button.scrollIntoView({ block: "center" });
    button.click();
    return true;
  })()`, { timeoutMs: 30_000, label: `${title} actions` });
}
async function ensurePersonalTemplateVisible(ctx) {
  await searchMarket(ctx, templateTitle);
  if (await ctx.eval(`[...document.querySelectorAll("h3")].some((item) => item.textContent?.trim() === ${JSON.stringify(templateTitle)})`)) return;
  await clickExactText(ctx, "我的模板");
  await ctx.waitForText(templateTitle, { timeoutMs: 30_000 });
}
async function chooseInPageFile(ctx, { name, type, bytesExpression }) {
  const chosen = await ctx.eval(`(() => {
    const input = document.querySelector('input[type="file"][accept=".ipwp,.ipwt"]');
    if (!input) return false;
    const file = new File([new Uint8Array(${bytesExpression})], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  ctx.assert(chosen, "The template package input was not available.");
  await ctx.waitForText(name, { timeoutMs: 10_000 });
}
async function chooseLocalFile(ctx, file) {
  const { root } = await ctx.client.send("DOM.getDocument", { depth: 1, pierce: true });
  const { nodeId } = await ctx.client.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: 'input[type="file"][accept=".ipwp,.ipwt"]',
  });
  ctx.assert(Boolean(nodeId), "The local template package input was not available.");
  await ctx.client.send("DOM.setFileInputFiles", { nodeId, files: [file] });
}
export default {
  id: "ipwp-template-export",
  title: "Video work saves or exports independently and safely round-trips as a canonical .ipwp package",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
    const route = await ctx.eval("window.__ipolloworkControl.snapshot().route");
    return route.startsWith("/welcome") || route.startsWith("/signin")
      ? "iPolloWork must have a local workspace before the template export flow can run."
      : null;
  },
  steps: [
    {
      name: "Validated Video work exposes save and canonical export",
      run: async (ctx) => {
        await ctx.prove("A valid Video work offers separate personal-save and export-only .ipwp actions", {
          voiceover: vo[0],
          action: async () => {
            await setChinese(ctx);
            state.workspaceId = await ctx.eval("location.hash.match(/\\/workspace\\/([^/]+)/)?.[1] || localStorage.getItem('ipollowork.react.activeWorkspace') || ''");
            ctx.assert(Boolean(state.workspaceId), "No active workspace was available.");
            await createVideoAuthoringSession(ctx);
            const snapshot = (await serverRequest(ctx, `/workspace/${state.workspaceId}/template-sessions/${state.sessionId}`)).data;
            state.sourcePath = snapshot.state.entry;
            await openSaveDialog(ctx);
            await ctx.waitFor(`(() => {
              const labels = ["保存到我的模板", "导出 .ipwp"];
              return labels.every((label) => [...document.querySelectorAll('[role=dialog] button')]
                .some((button) => button.textContent?.trim() === label && !button.disabled));
            })()`, { timeoutMs: 60_000, label: "enabled template save actions" });
          },
          assert: async () => {
            await ctx.expectText("保存到我的模板");
            await ctx.expectText("导出 .ipwp");
            const enabled = await ctx.eval(`(() => {
              const labels = ["保存到我的模板", "导出 .ipwp"];
              return labels.every((label) => [...document.querySelectorAll('[role=dialog] button')]
                .some((button) => button.textContent?.trim() === label && !button.disabled));
            })()`);
            ctx.assert(enabled, "Both save choices were not enabled after validation.");
            const layout = await ctx.eval(`(() => {
              const dialog = document.querySelector('[role=dialog]');
              const footer = dialog?.querySelector('[data-slot="dialog-footer"]');
              if (!dialog || !footer) return null;
              const style = getComputedStyle(footer);
              return {
                text: dialog.innerText,
                marginTop: parseFloat(style.marginTop),
                paddingBottom: parseFloat(style.paddingBottom),
              };
            })()`);
            ctx.assert(layout && !layout.text.includes("可以保存") && !layout.text.includes("类型已锁定"), "Removed save status or type metadata is still visible.");
            ctx.assert(layout.marginTop >= 16 && layout.paddingBottom >= 20, "The dialog footer does not have enough separation and bottom padding.");
          },
          screenshot: {
            name: "video-save-or-export-actions",
            requireText: ["保存为作品模板", "保存到我的模板", "导出 .ipwp"],
            rejectText: ["可以保存", "类型已锁定"],
          },
        });
      },
    },
    {
      name: "Export creates a portable package without saving a personal template",
      run: async (ctx) => {
        await ctx.prove("Export packages the current work without adding anything to My templates", {
          voiceover: vo[1],
          action: async () => {
            await ctx.fill('[role="dialog"] input', exportTitle);
            await ctx.fill('[role="dialog"] textarea', "Fraimz export-only IPWP video template.");
            state.sourceEntry = (await serverRequest(ctx, `/workspace/${state.workspaceId}/files/content?path=${encodeURIComponent(state.sourcePath)}`)).data.content;
            const catalogBefore = (await serverRequest(ctx, `/workspace/${state.workspaceId}/templates`)).data.items;
            await ctx.eval(`window.__fraimzTemplateIdsBeforeExport = ${JSON.stringify(catalogBefore.map((item) => item.manifest.id))}`);
            const exported = await serverRequest(
              ctx,
              `/workspace/${state.workspaceId}/templates/from-session/package`,
              {
                method: "POST",
                binary: true,
                body: { sessionId: state.sessionId, category: "video", title: exportTitle, description: "Fraimz export-only IPWP video template." },
              },
            );
            state.packageName = exported.disposition?.match(/filename="?([^";]+)"?/)?.[1] ?? "";
            state.localPackageDirectory = await mkdtemp(join(tmpdir(), "ipollowork-ipwp-package-"));
            state.localPackageName = state.packageName;
            state.localPackagePath = join(state.localPackageDirectory, state.localPackageName);
            await writeFile(state.localPackagePath, Buffer.from(exported.bytes));
            const localPackage = await readFile(state.localPackagePath);
            ctx.assert(localPackage.equals(Buffer.from(exported.bytes)), "The portable package differs from the canonical package response.");
            await clickExactText(ctx, "取消", "[role=dialog] button");
            await openTemplateMarket(ctx);
            await clickExactText(ctx, "我的模板");
            await ctx.fill('input[placeholder="搜索模板"]', exportTitle);
            await ctx.waitForText("没有找到模板", { timeoutMs: 30_000 });
          },
          assert: async () => {
            ctx.assert(state.localPackageName.endsWith(".ipwp"), `Expected a canonical .ipwp package, got ${state.localPackageName}.`);
            ctx.assert(state.packageName.endsWith(".ipwp"), `Server filename was not canonical: ${state.packageName}.`);
            const catalog = (await serverRequest(ctx, `/workspace/${state.workspaceId}/templates`)).data.items;
            const before = await ctx.eval("window.__fraimzTemplateIdsBeforeExport");
            ctx.assert(JSON.stringify(catalog.map((item) => item.manifest.id)) === JSON.stringify(before), "Export changed the personal template catalog.");
            ctx.assert(!catalog.some((item) => item.manifest.title === exportTitle), "Export-only work was added to My templates.");
            const after = (await serverRequest(ctx, `/workspace/${state.workspaceId}/files/content?path=${encodeURIComponent(state.sourcePath)}`)).data.content;
            ctx.assert(after === state.sourceEntry, "The source Video work changed while exporting.");
            await ctx.expectText("没有找到模板");
          },
          screenshot: {
            name: "export-does-not-save-personal-template",
            requireText: ["我的模板", "没有找到模板"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Save creates one personal template and only personal templates expose repeat export",
      run: async (ctx) => {
        await ctx.prove("Save adds one independent item whose actions include .ipwp export while official template actions do not", {
          voiceover: vo[2],
          action: async () => {
            await closeTemplateMarket(ctx);
            await ctx.navigateHash(`/workspace/${state.workspaceId}/session/${state.sessionId}`);
            await openSaveDialog(ctx);
            await ctx.fill('[role="dialog"] input', templateTitle);
            await ctx.fill('[role="dialog"] textarea', "Fraimz saved personal video template.");
            await ctx.clickText("保存到我的模板", { selector: "[role=dialog] button" });
            await ctx.waitFor(`![...document.querySelectorAll('[role=dialog]')]
              .some((dialog) => dialog.innerText.includes("保存为作品模板"))`, {
              timeoutMs: 30_000,
              label: "save dialog to close",
            });
            state.template = await eventually(async () => {
              const catalog = (await serverRequest(ctx, `/workspace/${state.workspaceId}/templates`)).data;
              return catalog.items.find((item) => item.manifest.title === templateTitle) ?? null;
            }, { label: "saved personal video template" });
            await ensurePersonalTemplateVisible(ctx);
            await openTemplateActions(ctx, templateTitle);
            await ctx.expectText("导出 .ipwp");
            await ctx.screenshot("personal-template-repeat-export", {
              claim: "A personal template can be exported again as .ipwp",
              voiceover: vo[2],
              requireText: [templateTitle, "我的", "导出 .ipwp"],
            });
            await openTemplateActions(ctx, templateTitle);
            await ctx.waitFor("!document.querySelector('[role=menu]')", {
              timeoutMs: 10_000,
              label: "personal template action menu to close",
            });
            const catalog = (await serverRequest(ctx, `/workspace/${state.workspaceId}/templates`)).data;
            state.officialTemplate = catalog.items.find((item) => item.sourceType === "bundled" && item.installed);
            ctx.assert(Boolean(state.officialTemplate), "No installed official template was available for comparison.");
            await clickExactText(ctx, "我的模板");
            await ctx.fill('input[placeholder="搜索模板"]', state.officialTemplate.manifest.title);
            await ctx.waitForText(state.officialTemplate.manifest.title, { timeoutMs: 30_000 });
            await openTemplateActions(ctx, state.officialTemplate.manifest.title);
          },
          assert: async () => {
            const menu = await ctx.eval("document.querySelector('[role=menu]')?.innerText || ''");
            ctx.assert(!menu.includes("导出 .ipwp"), "An official template exposed the personal export action.");
            ctx.assert(state.template.sourceType === "local" && state.template.manifest.id.startsWith("personal."), "Save did not create an independent personal template.");
            const officialExport = await serverRequest(
              ctx,
              `/workspace/${state.workspaceId}/templates/${encodeURIComponent(state.officialTemplate.manifest.id)}/package`,
              { binary: true, tolerate: true },
            );
            ctx.assert(officialExport.status === 404, `Official export returned ${officialExport.status} instead of 404.`);
            await ctx.expectText("官方");
          },
          screenshot: {
            name: "official-template-export-hidden",
            requireText: ["官方", "卸载模板"],
            rejectText: ["导出 .ipwp"],
          },
        });
      },
    },
    {
      name: "Exported .ipwp safely installs twice and opens Video Studio",
      run: async (ctx) => {
        await ctx.prove("An export-only package installs idempotently through the shared .ipwp/.ipwt parser and materializes a Video work", {
          voiceover: vo[3],
          action: async () => {
            await ctx.eval(`(() => {
              const trigger = [...document.querySelectorAll("button")]
                .find((item) => item.getAttribute("aria-label") === ${JSON.stringify(`${state.officialTemplate.manifest.title} 更多操作`)});
              trigger?.click();
            })()`);
            await ctx.waitFor("!document.querySelector('[role=menu]')", {
              timeoutMs: 10_000,
              label: "template action menu to close",
            });
            await clickExactText(ctx, "我的模板");
            await chooseLocalFile(ctx, state.localPackagePath);
            await ctx.waitForText(state.localPackageName, { timeoutMs: 10_000 });
            await clickExactText(ctx, "安装");
            await ctx.waitForText(`已安装 ${exportTitle}`, { timeoutMs: 60_000 });
            state.importedTemplate = await eventually(async () => {
              const catalog = (await serverRequest(ctx, `/workspace/${state.workspaceId}/templates`)).data;
              return catalog.items.find((item) => item.manifest.title === exportTitle) ?? null;
            }, { label: "imported export-only template" });
            await chooseLocalFile(ctx, state.localPackagePath);
            await clickExactText(ctx, "安装");
            await ctx.waitFor(`!document.body.innerText.includes(${JSON.stringify(state.localPackageName)})`, {
              timeoutMs: 60_000,
              label: "repeat import to finish without a version conflict",
            });
            const conflictVisible = await ctx.eval(`[...document.querySelectorAll("[data-sonner-toast]")]
              .some((toast) => /different package|version conflict|不同.*包|版本冲突/i.test(toast.textContent || ""))`);
            ctx.assert(!conflictVisible, "Repeat import reported a false package version conflict.");
            await ctx.fill('input[placeholder="搜索模板"]', exportTitle);
            await ctx.waitForText(exportTitle, { timeoutMs: 30_000 });
            const before = await ctx.eval("location.hash");
            const used = await ctx.eval(`(() => {
              const heading = [...document.querySelectorAll("h3")]
                .find((node) => node.textContent?.trim() === ${JSON.stringify(exportTitle)});
              const card = heading?.closest("article");
              const button = card ? [...card.querySelectorAll("button")]
                .find((item) => item.textContent?.trim() === "使用" && !item.disabled) : null;
              button?.click();
              return Boolean(button);
            })()`);
            ctx.assert(used, "The re-imported template did not expose Use.");
            await ctx.waitFor(`location.hash !== ${JSON.stringify(before)} && /\\/session\\//.test(location.hash)`, {
              timeoutMs: 60_000,
              label: "re-imported template session",
            });
            if (await ctx.hasText("定义这支视频")) {
              await ctx.fill('input[placeholder="例如：新品发布预告"]', "IPWP 往返测试");
              await ctx.fill('input[placeholder="例如：正在评估创意工具的产品团队"]', "模板创作者");
              await ctx.fill('input[placeholder="例如：介绍核心卖点，引导预约体验"]', "验证可移植视频模板");
              await clickExactText(ctx, "开始制作视频");
            }
            await ctx.waitFor(`[...document.querySelectorAll("iframe")]
              .some((frame) => frame.title.includes("HyperFrames") && frame.dataset.loaded === "true")`, {
              timeoutMs: 90_000,
              label: "re-imported Video Studio",
            });
          },
          assert: async () => {
            const catalog = (await serverRequest(ctx, `/workspace/${state.workspaceId}/templates`)).data;
            const restored = catalog.items.find((item) => item.manifest.id === state.importedTemplate.manifest.id);
            ctx.assert(restored?.sourceType === "local" && restored.manifest.surface === "video", "The imported package did not restore the personal Video template.");
            await ctx.expectText("视频工作室");
            await ctx.expectText("就绪", { timeoutMs: 60_000 });
          },
          screenshot: {
            name: "reimported-ipwp-video-studio",
            requireText: ["视频工作室", "就绪"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Invalid .ipwp is rejected without partial installation",
      run: async (ctx) => {
        await ctx.prove("A malformed canonical package is rejected and leaves no template behind", {
          voiceover: vo[4],
          action: async () => {
            await openTemplateMarket(ctx);
            const before = (await serverRequest(ctx, `/workspace/${state.workspaceId}/templates`)).data.items.length;
            await ctx.eval(`window.__fraimzCatalogCountBeforeInvalid = ${before}`);
            await chooseInPageFile(ctx, {
              name: invalidPackageName,
              type: "application/vnd.ipollowork.package+zip",
              bytesExpression: "[1, 2, 3, 4]",
            });
            await clickExactText(ctx, "安装");
            await ctx.waitFor(`!document.body.innerText.includes(${JSON.stringify(invalidPackageName)})
              && [...document.querySelectorAll("[data-sonner-toast]")].some((toast) => /ZIP|压缩|package|模板包/i.test(toast.textContent || ""))`, {
              timeoutMs: 30_000,
              label: "invalid package error",
            });
          },
          assert: async () => {
            const catalog = (await serverRequest(ctx, `/workspace/${state.workspaceId}/templates`)).data;
            const before = await ctx.eval("window.__fraimzCatalogCountBeforeInvalid");
            ctx.assert(catalog.items.length === before, "Invalid import changed the template catalog.");
            ctx.assert(!catalog.items.some((item) => item.manifest.title === invalidPackageName), "Invalid import left a partial template item.");
            const selectionCleared = await ctx.eval(`!document.body.innerText.includes(${JSON.stringify(invalidPackageName)})`);
            ctx.assert(selectionCleared, "The rejected package remained selected after the failed install.");
          },
          screenshot: {
            name: "invalid-ipwp-rejected",
            requireText: ["The template package is not a valid ZIP"],
            rejectText: [invalidPackageName, "Something went wrong"],
          },
        });
        const catalog = (await serverRequest(ctx, `/workspace/${state.workspaceId}/templates`)).data;
        const generatedTemplates = catalog.items.filter((item) => item.sourceType === "local"
          && (item.manifest.title.startsWith("Fraimz Export Only Video ") || item.manifest.title.startsWith("Fraimz Saved Video ")));
        for (const template of generatedTemplates) {
          await serverRequest(ctx, `/workspace/${state.workspaceId}/templates/${encodeURIComponent(template.manifest.id)}`, {
            method: "DELETE",
          });
        }
        if (state.localPackageDirectory) {
          await rm(state.localPackageDirectory, { recursive: true, force: true });
        }
      },
    },
  ],
};
