import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { writeUnifiedEnginePluginFixture } from "../support/unified-engine-plugin-fixture.mjs";

const vo = await loadVoiceoverParagraphs("unified-engine-plugin-runtime");
const PLUGIN_ID = "fraimz-unified-runtime";
const PLUGIN_NAME = "统一插件运行验证";
const WORKSPACE_APP_LABEL = "统一画板";
const IMPORT_FIXTURE = join(tmpdir(), `${PLUGIN_ID}.zip`);

await writeUnifiedEnginePluginFixture({
  path: IMPORT_FIXTURE,
  pluginId: PLUGIN_ID,
  pluginName: PLUGIN_NAME,
  workspaceAppLabel: WORKSPACE_APP_LABEL,
});

async function api(ctx, path, options = {}) {
  return ctx.eval(`(async () => {
    const baseUrl = localStorage.getItem('ipollowork.server.urlOverride');
    const token = localStorage.getItem('ipollowork.server.token');
    const response = await fetch(baseUrl + ${JSON.stringify(path)}, {
      method: ${JSON.stringify(options.method ?? "GET")},
      headers: {
        Authorization: 'Bearer ' + token,
        ${options.body === undefined ? "" : "'Content-Type': 'application/json',"}
      },
      ${options.body === undefined ? "" : `body: JSON.stringify(${JSON.stringify(options.body)}),`}
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  })()`, { awaitPromise: true });
}

async function workspaces(ctx) {
  const response = await api(ctx, "/workspaces");
  ctx.assert(response.status === 200, `Could not list projects: ${JSON.stringify(response)}`);
  return response.body.items ?? response.body.workspaces ?? [];
}

async function ensureEngineWorkspace(ctx, engineId) {
  const existing = (await workspaces(ctx)).find((workspace) => workspace.engineId === engineId);
  if (existing) {
    await ctx.navigateHash(`/workspace/${existing.id}/session`);
    await ctx.waitFor(`location.hash.includes('/workspace/${existing.id}/')`, {
      timeoutMs: 30_000,
      label: `${engineId} project selected`,
    });
    return existing;
  }

  await ctx.eval(`document.querySelector('[data-testid="new-project-button"]')?.click()`);
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=create-project-dialog]'))", {
    timeoutMs: 15_000,
    label: "create project dialog",
  });
  await ctx.fill("#create-project-name", engineId === "deepseek-harness" ? "统一插件 DSH 验证" : "统一插件 OpenCode 验证");
  await ctx.eval(`document.querySelector('[data-testid="project-engine-option"][data-engine-id="${engineId}"] input')?.click()`);
  const created = await ctx.eval(`(() => {
    const dialog = document.querySelector('[data-testid=create-project-dialog]');
    const button = [...(dialog?.querySelectorAll('button') ?? [])].find((entry) => ['创建', 'Create'].includes(entry.textContent?.trim() ?? ''));
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(created, `Could not create the ${engineId} project`);
  await ctx.waitFor(`!document.querySelector('[data-testid=create-project-dialog]') && location.hash.includes('/workspace/')`, {
    timeoutMs: 60_000,
    label: `${engineId} project created`,
  });
  const createdWorkspace = (await workspaces(ctx)).find((workspace) => workspace.engineId === engineId);
  ctx.assert(createdWorkspace, `The created ${engineId} project was not persisted`);
  return createdWorkspace;
}

async function workspaceSessionRoute(ctx, workspace) {
  const response = await api(ctx, `/workspace/${workspace.id}/sessions`);
  ctx.assert(response.status === 200, `Could not list ${workspace.engineId} tasks: ${JSON.stringify(response)}`);
  const items = response.body.items ?? [];
  const session = items.find((item) => !item.dsh?.blank && !item.time?.archived) ?? items.find((item) => !item.time?.archived) ?? items[0];
  return session
    ? `/workspace/${workspace.id}/session/${encodeURIComponent(session.id)}`
    : `/workspace/${workspace.id}/session`;
}

async function selectPersonalPlugins(ctx) {
  await ctx.navigateHash("/settings/extensions");
  await ctx.waitFor(`Boolean([...document.querySelectorAll('button')].find((entry) => ['个人', 'Personal'].includes(entry.textContent?.trim() ?? '')))`, {
    timeoutMs: 30_000,
    label: "personal plugin source",
  });
  await ctx.eval(`[...document.querySelectorAll('button')].find((entry) => ['个人', 'Personal'].includes(entry.textContent?.trim() ?? ''))?.click()`);
  await ctx.waitFor(`document.body.innerText.includes('管理全局安装或导入的插件') || document.body.innerText.includes('Manage globally installed or imported plugins.')`, {
    timeoutMs: 30_000,
    label: "personal plugin catalog",
  });
}

async function choosePluginPackage(ctx, file) {
  const { root } = await ctx.client.send("DOM.getDocument", { depth: 1, pierce: true });
  const { nodeId } = await ctx.client.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: 'input[type="file"][accept*=".ipollowork-plugin"]',
  });
  ctx.assert(Boolean(nodeId), "The plugin package file input was not found.");
  await ctx.client.send("DOM.setFileInputFiles", { nodeId, files: [file] });
}

async function clickButton(ctx, labels, rootSelector = "body") {
  const clicked = await ctx.eval(`(() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)}) ?? document.body;
    const button = [...root.querySelectorAll('button')].find((entry) => ${JSON.stringify(labels)}.includes(entry.textContent?.trim() ?? ''));
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(clicked, `Could not find button: ${labels.join(" / ")}`);
}

async function openWorkspaceApp(ctx) {
  await ctx.waitFor(`!['正在准备工作区', 'Preparing workspace', '正在拉取此任务的最新消息。', 'Pulling in the latest messages for this task.']
    .some((text) => document.body.innerText.includes(text))`, {
    timeoutMs: 120_000,
    label: "task ready after engine capability refresh",
  });
  await ctx.waitFor(`Boolean([...document.querySelectorAll('button')].find((entry) =>
    ['打开右侧面板', 'Open right panel', '收起右侧面板', 'Close right panel'].includes(entry.getAttribute('aria-label') ?? '')
  ))`, {
    timeoutMs: 90_000,
    label: "task and right-side panel controls ready",
  });
  const openedPanel = await ctx.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find((entry) => ['打开右侧面板', 'Open right panel'].includes(entry.getAttribute('aria-label') ?? ''));
    button?.click();
    return Boolean(button);
  })()`);
  if (openedPanel) await new Promise((resolve) => setTimeout(resolve, 500));
  await ctx.waitFor(`Boolean([...document.querySelectorAll('button')].find((entry) =>
    entry.textContent?.trim() === ${JSON.stringify(WORKSPACE_APP_LABEL)}
      || ['添加侧面板入口', 'Add side panel entry', '添加面板', 'Add panel'].includes(entry.getAttribute('aria-label') ?? '')
  ))`, {
    timeoutMs: 30_000,
    label: "right-side Workspace App controls",
  });
  let clicked = await ctx.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === ${JSON.stringify(WORKSPACE_APP_LABEL)});
    button?.click();
    return Boolean(button);
  })()`);
  if (!clicked) {
    const menuOpened = await ctx.eval(`(() => {
      const button = [...document.querySelectorAll('button')].find((entry) => ['添加侧面板入口', 'Add side panel entry', '添加面板', 'Add panel'].includes(entry.getAttribute('aria-label') ?? ''));
      button?.click();
      return Boolean(button);
    })()`);
    ctx.assert(menuOpened, "The right-side app picker was not available");
    await ctx.waitFor("document.querySelectorAll('[role=menuitem]').length > 0", { timeoutMs: 10_000, label: "right-side app menu" });
    clicked = await ctx.eval(`(() => {
      const entry = [...document.querySelectorAll('[role=menuitem]')].find((item) => item.textContent?.includes(${JSON.stringify(WORKSPACE_APP_LABEL)}));
      entry?.click();
      return Boolean(entry);
    })()`);
  }
  ctx.assert(Boolean(clicked), "The installed Workspace App could not be opened");
  await ctx.waitFor(`Boolean(document.querySelector('iframe[title=${JSON.stringify(WORKSPACE_APP_LABEL)}]'))`, {
    timeoutMs: 30_000,
    label: "installed Workspace App frame",
  });
}

let dshWorkspace;
let openCodeWorkspace;
let dshSessionRoute = "";

export default {
  id: "unified-engine-plugin-runtime",
  title: "One global plugin lifecycle across OpenCode and DeepSeek Harness",
  kind: "user-facing",
  steps: [
    {
      name: "Install one plugin from a DeepSeek Harness project",
      run: async (ctx) => {
        await ctx.prove("A DeepSeek Harness project installs the same global plugin package", {
          voiceover: vo[0],
          action: async () => {
            await ctx.eval(`localStorage.setItem('ipollowork.language', 'zh'); true`);
            dshWorkspace = await ensureEngineWorkspace(ctx, "deepseek-harness");
            dshSessionRoute = await workspaceSessionRoute(ctx, dshWorkspace);
            const existing = await api(ctx, `/workspace/${dshWorkspace.id}/plugin-packages`);
            if (!existing.body.items?.some((item) => item.pluginId === PLUGIN_ID)) {
              await selectPersonalPlugins(ctx);
              await clickButton(ctx, ["添加", "Add", "导入插件", "Import plugin"]);
              await ctx.waitFor(`document.body.innerText.includes('导入完整插件包') || document.body.innerText.includes('Import complete plugin package')`, {
                timeoutMs: 30_000,
                label: "complete plugin import dialog",
              });
              await choosePluginPackage(ctx, IMPORT_FIXTURE);
              await ctx.waitFor(`document.body.innerText.includes(${JSON.stringify(PLUGIN_NAME)}) && (document.body.innerText.includes('声明式安全检查') || document.body.innerText.includes('Declarative safety'))`, {
                timeoutMs: 45_000,
                label: "unified plugin import preview",
              });
              await clickButton(ctx, ["安装插件", "Install plugin"], '[role="dialog"]');
            } else {
              await ctx.navigateHash(`/settings/extensions/plugin/${PLUGIN_ID}`);
            }
            await ctx.waitFor(`location.hash.includes('/settings/extensions/plugin/${PLUGIN_ID}') && document.body.innerText.includes(${JSON.stringify(PLUGIN_NAME)})`, {
              timeoutMs: 60_000,
              label: "unified plugin detail",
            });
          },
          assert: async () => {
            const packages = await api(ctx, `/workspace/${dshWorkspace.id}/plugin-packages`);
            ctx.assert(packages.body.items?.some((item) => item.pluginId === PLUGIN_ID && item.enabled), "The global plugin inventory does not contain the installed package");
            await ctx.expectText(PLUGIN_NAME);
            await ctx.expectText("统一插件工作流");
            await ctx.expectText(WORKSPACE_APP_LABEL);
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "dsh-plugin-installed",
            requireText: [PLUGIN_NAME, "统一插件工作流", WORKSPACE_APP_LABEL, "Fraimz Runtime Proof"],
            rejectText: ["Something went wrong"],
            hashIncludes: `/settings/extensions/plugin/${PLUGIN_ID}`,
          },
        });
      },
    },
    {
      name: "Use DSH plugin capabilities and the right-side app",
      run: async (ctx) => {
        await ctx.prove("DeepSeek Harness receives MCP, prompt, service, and Workspace App capabilities through one host protocol", {
          voiceover: vo[1],
          action: async () => {
            await ctx.navigateHash(dshSessionRoute || `/workspace/${dshWorkspace.id}/session`);
            await ctx.waitFor(`location.hash.includes('/workspace/${dshWorkspace.id}/')`, { timeoutMs: 30_000, label: "DSH task restored" });
            await openWorkspaceApp(ctx);
            const tools = await api(ctx, "/engine-tools/call", {
              method: "POST",
              body: { name: "ipollowork_workspace_app_list_tools", args: {}, context: { workspaceId: dshWorkspace.id } },
            });
            ctx.assert(tools.status === 200 && tools.body.result?.tools?.some((tool) => tool.name === "append_note"), `Workspace App tools were not visible: ${JSON.stringify(tools)}`);
            const call = await api(ctx, "/engine-tools/call", {
              method: "POST",
              body: {
                name: "ipollowork_workspace_app_call_tool",
                args: { name: "append_note", arguments: { text: "DSH unified plugin verified" } },
                context: { workspaceId: dshWorkspace.id },
              },
            });
            ctx.assert(call.status === 200 && call.body.result?.structuredContent?.canvas?.includes("DSH unified plugin verified"), `Workspace App tool call failed: ${JSON.stringify(call)}`);
          },
          assert: async () => {
            const [capabilities, mcp, serviceActions, hostTools] = await Promise.all([
              api(ctx, `/workspace/${dshWorkspace.id}/engine/deepseek-harness/plugin-capabilities`),
              api(ctx, `/workspace/${dshWorkspace.id}/mcp`),
              api(ctx, "/engine-tools/call", {
                method: "POST",
                body: {
                  name: "ipollowork_extension_list_actions",
                  args: {},
                  context: { workspaceId: dshWorkspace.id },
                },
              }),
              api(ctx, "/engine-tools"),
            ]);
            const promptTypes = new Set(capabilities.body.items?.filter((item) => item.pluginId === PLUGIN_ID).map((item) => item.type));
            ctx.assert(promptTypes.has("command") && promptTypes.has("agent"), "DSH did not receive the plugin command and agent");
            ctx.assert(mcp.body.items?.some((item) => item.name === PLUGIN_ID), "DSH did not receive the plugin MCP");
            ctx.assert(serviceActions.body.actions?.length > 0, "DSH could not discover installed local-service actions");
            ctx.assert(hostTools.body.tools?.length === 4, "The engine-neutral host tool catalog is incomplete");
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "dsh-workspace-app",
            requireText: [WORKSPACE_APP_LABEL, "DeepSeek Harness"],
            rejectText: ["Something went wrong", "could not be displayed"],
            hashIncludes: `/workspace/${dshWorkspace.id}/`,
          },
        });
      },
    },
    {
      name: "Switch to OpenCode without reinstalling",
      run: async (ctx) => {
        await ctx.prove("The same globally installed plugin is already active after switching to OpenCode", {
          voiceover: vo[2],
          action: async () => {
            openCodeWorkspace = await ensureEngineWorkspace(ctx, "opencode");
            const openCodeSessionRoute = await workspaceSessionRoute(ctx, openCodeWorkspace);
            await ctx.navigateHash(openCodeSessionRoute);
            await ctx.waitFor(`location.hash.includes('/workspace/${openCodeWorkspace.id}/session/')`, { timeoutMs: 30_000, label: "OpenCode task selected" });
            await openWorkspaceApp(ctx);
          },
          assert: async () => {
            const [packages, commands, skills, mcp] = await Promise.all([
              api(ctx, `/workspace/${openCodeWorkspace.id}/plugin-packages`),
              api(ctx, `/workspace/${openCodeWorkspace.id}/commands`),
              api(ctx, `/workspace/${openCodeWorkspace.id}/skills`),
              api(ctx, `/workspace/${openCodeWorkspace.id}/mcp`),
            ]);
            ctx.assert(packages.body.items?.some((item) => item.pluginId === PLUGIN_ID && item.enabled), "OpenCode does not see the global plugin inventory");
            ctx.assert(commands.body.items?.some((item) => item.name === "verify-unified-plugin"), "OpenCode did not receive the plugin command");
            ctx.assert(skills.body.items?.some((item) => item.name === "unified-runtime"), "OpenCode did not receive the plugin Skill");
            ctx.assert(mcp.body.items?.some((item) => item.name === PLUGIN_ID), "OpenCode did not receive the plugin MCP");
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "opencode-same-plugin",
            requireText: [WORKSPACE_APP_LABEL],
            rejectText: ["Something went wrong", "could not be displayed"],
            hashIncludes: "/session/",
          },
        });
      },
    },
    {
      name: "Uninstall once and remove every engine capability",
      run: async (ctx) => {
        await ctx.prove("One global uninstall removes the plugin from OpenCode and DeepSeek Harness", {
          voiceover: vo[3],
          action: async () => {
            await ctx.navigateHash(`/settings/extensions/plugin/${PLUGIN_ID}`);
            await ctx.waitFor(`document.body.innerText.includes('卸载插件') || document.body.innerText.includes('Uninstall plugin')`, {
              timeoutMs: 30_000,
              label: "global uninstall control",
            });
            await clickButton(ctx, ["卸载插件", "Uninstall plugin"]);
            await ctx.waitFor(`location.hash.endsWith('/settings/extensions') && !document.body.innerText.includes(${JSON.stringify(PLUGIN_NAME)})`, {
              timeoutMs: 60_000,
              label: "global plugin uninstall",
            });
          },
          assert: async () => {
            const [dshPackages, openCodePackages, dshCapabilities, dshMcp, openCodeCommands, openCodeSkills, openCodeMcp] = await Promise.all([
              api(ctx, `/workspace/${dshWorkspace.id}/plugin-packages`),
              api(ctx, `/workspace/${openCodeWorkspace.id}/plugin-packages`),
              api(ctx, `/workspace/${dshWorkspace.id}/engine/deepseek-harness/plugin-capabilities`),
              api(ctx, `/workspace/${dshWorkspace.id}/mcp`),
              api(ctx, `/workspace/${openCodeWorkspace.id}/commands`),
              api(ctx, `/workspace/${openCodeWorkspace.id}/skills`),
              api(ctx, `/workspace/${openCodeWorkspace.id}/mcp`),
            ]);
            ctx.assert(!dshPackages.body.items?.some((item) => item.pluginId === PLUGIN_ID), "The plugin remains installed in DSH");
            ctx.assert(!openCodePackages.body.items?.some((item) => item.pluginId === PLUGIN_ID), "The plugin remains installed in OpenCode");
            ctx.assert(!dshCapabilities.body.items?.some((item) => item.pluginId === PLUGIN_ID), "DSH command or agent remains after uninstall");
            ctx.assert(!dshMcp.body.items?.some((item) => item.name === PLUGIN_ID), "DSH MCP remains after uninstall");
            ctx.assert(!openCodeCommands.body.items?.some((item) => item.name === "verify-unified-plugin"), "OpenCode command remains after uninstall");
            ctx.assert(!openCodeSkills.body.items?.some((item) => item.name === "unified-runtime"), "OpenCode Skill remains after uninstall");
            ctx.assert(!openCodeMcp.body.items?.some((item) => item.name === PLUGIN_ID), "OpenCode MCP remains after uninstall");
            await ctx.expectNoText(PLUGIN_NAME);
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "global-plugin-uninstalled",
            requireText: ["插件", "添加"],
            rejectText: [PLUGIN_NAME, "Something went wrong"],
            hashIncludes: "/settings/extensions",
          },
        });
      },
    },
  ],
};
