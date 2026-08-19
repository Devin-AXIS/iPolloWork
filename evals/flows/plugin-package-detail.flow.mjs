import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("plugin-package-detail");
const SKILL_TOGGLE = '[role="switch"][aria-label="开关设计转代码"]';
const IMPORT_FIXTURE = join(tmpdir(), "fraimz-community-notes.ipollowork-plugin");

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let entry = value;
  for (let bit = 0; bit < 8; bit += 1) entry = entry & 1 ? 0xedb88320 ^ (entry >>> 1) : entry >>> 1;
  return entry >>> 0;
});

function crc32(data) {
  let checksum = 0xffffffff;
  for (const byte of data) checksum = CRC32_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
}

function storedZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, contents] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(contents);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

const importManifest = {
  schemaVersion: 1,
  id: "fraimz-community-notes",
  name: "Community Notes",
  description: "A declarative community plugin used to verify safe package import.",
  category: "Productivity",
  source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false },
  package: {
    version: "1.0.0",
    publisher: { id: "fraimz", name: "Fraimz Developer" },
    updateId: "fraimz/community-notes",
    entrypoints: {},
  },
  resources: [
    {
      type: "skill",
      id: "community-notes",
      label: "Community Notes",
      description: "Turn research notes into a concise shared summary.",
      path: ".opencode/skills/community-notes/SKILL.md",
      required: true,
    },
    {
      type: "command",
      id: "summarize-community-notes",
      label: "Summarize Notes",
      description: "Prepare a concise community notes summary.",
      path: ".opencode/commands/summarize-community-notes.md",
      required: true,
    },
  ],
};
await writeFile(IMPORT_FIXTURE, storedZip({
  "community-notes/ipollowork.plugin.json": JSON.stringify(importManifest, null, 2),
  "community-notes/.opencode/skills/community-notes/SKILL.md": "---\nname: community-notes\ndescription: Summarize shared research notes.\n---\n\n# Community Notes\n\nRead the supplied notes and prepare a concise sourced summary.\n",
  "community-notes/.opencode/commands/summarize-community-notes.md": "Summarize the selected research notes into a concise shared brief.\n",
}));

async function clickExactButton(ctx, label) {
  const clicked = await ctx.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === ${JSON.stringify(label)});
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(clicked, `Could not find button: ${label}`);
}

async function dismissOpenDialogs(ctx) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const count = await ctx.eval("document.querySelectorAll('[role=\"dialog\"]').length");
    if (count === 0) return;
    const dismissed = await ctx.eval(`(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      const dialog = dialogs.at(-1);
      const button = [...(dialog?.querySelectorAll('button') ?? [])].find((entry) =>
        ['取消', 'Cancel', '完成', 'Done'].includes(entry.textContent?.trim() ?? '')
      );
      button?.click();
      return Boolean(button);
    })()`);
    ctx.assert(dismissed, "Could not dismiss an open dialog before the plugin flow");
    await ctx.waitFor(`document.querySelectorAll('[role="dialog"]').length < ${count}`, {
      timeoutMs: 5_000,
      label: "open plugin dialog dismissed",
    });
  }
}

async function selectPersonalResourceScope(ctx) {
  await ctx.waitFor(`
    [...document.querySelectorAll('button')].some((entry) => ['个人', 'Personal'].includes(entry.textContent?.trim() ?? ''))
      || document.body.innerText.includes('独立插件包')
      || document.body.innerText.includes('Independent plugin packages')
  `, {
    timeoutMs: 30_000,
    label: "personal resource scope or local plugin catalog",
  });
  await ctx.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find((entry) => ['个人', 'Personal'].includes(entry.textContent?.trim() ?? ''));
    button?.click();
  })()`);
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

function pluginCardActionExpression(name, labels, click = false) {
  return `(() => {
    const title = [...document.querySelectorAll('h1, h2, h3, h4, p, span, div')].find((entry) =>
      entry.children.length === 0 && entry.textContent?.trim() === ${JSON.stringify(name)}
    );
    let container = title?.parentElement;
    while (container && container !== document.body) {
      const buttons = [...container.querySelectorAll('button')];
      if (buttons.length === 0) {
        container = container.parentElement;
        continue;
      }
      const button = buttons.find((entry) =>
        ${JSON.stringify(labels)}.includes(entry.textContent?.trim() ?? '')
      );
      if (button) {
        ${click ? "button.click();" : ""}
        return true;
      }
      return false;
    }
    return false;
  })()`;
}

async function installCatalogPlugin(ctx, name) {
  const installedLabels = ["授权连接", "打开", "Connect", "Open"];
  const alreadyInstalled = await ctx.eval(pluginCardActionExpression(name, installedLabels));
  if (!alreadyInstalled) {
    const clicked = await ctx.eval(pluginCardActionExpression(name, ["安装", "Install"], true));
    ctx.assert(clicked, `Could not find the ${name} install button`);
  }
  await ctx.waitFor(pluginCardActionExpression(name, installedLabels), {
    timeoutMs: 45_000,
    label: `${name} installed in plugin catalog`,
  });
}

export default {
  id: "plugin-package-detail",
  title: "Independent plugin detail and per-skill controls",
  kind: "user-facing",
  steps: [
    {
      name: "Open Figma as a dedicated plugin detail",
      run: async (ctx) => {
        await ctx.prove("Opening an installed plugin shows a dedicated Codex-style detail view", {
          voiceover: vo[0],
          action: async () => {
            await dismissOpenDialogs(ctx);
            await ctx.navigateHash("/settings/preferences");
            await ctx.waitForText("偏好设置", { timeoutMs: 30_000 });
            await ctx.navigateHash("/settings/extensions");
            await selectPersonalResourceScope(ctx);
            await ctx.waitForText("独立插件包", { timeoutMs: 30_000 });
            const updateStarted = await ctx.eval(pluginCardActionExpression("Figma", ["更新", "Update"], true));
            if (!updateStarted) await installCatalogPlugin(ctx, "Figma");
            await ctx.waitFor("document.body.innerText.includes('Figma') && /已安装(?:[1-9]\\d*)个/.test(document.body.innerText)", {
              timeoutMs: 45_000,
              label: "Figma installed in plugin catalog",
            });
            await ctx.navigateHash("/settings/extensions/plugin/figma");
            await ctx.waitFor("document.body.innerText.includes('技能 12')", {
              timeoutMs: 30_000,
              label: "Figma plugin detail",
            });
          },
          assert: async () => {
            await ctx.expectText("插件");
            await ctx.expectText("Figma 官方 Desktop MCP");
            await ctx.expectText("技能 12");
            await ctx.expectNoText("独立插件包");
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "plugin-detail-open",
            requireText: ["插件", "Figma", "应用 1", "技能 12"],
            rejectText: ["独立插件包", "添加自定义应用", "Something went wrong"],
            hashIncludes: "/settings/extensions/plugin/figma",
          },
        });
      },
    },
    {
      name: "Disable one skill",
      run: async (ctx) => {
        await ctx.prove("A single skill can be disabled without closing the plugin detail", {
          voiceover: vo[1],
          action: async () => {
            await ctx.eval(`(() => {
              const toggle = document.querySelector(${JSON.stringify(SKILL_TOGGLE)});
              toggle?.scrollIntoView({ block: 'center' });
              toggle?.click();
              return Boolean(toggle);
            })()`);
            await ctx.waitFor(`document.querySelector(${JSON.stringify(SKILL_TOGGLE)})?.getAttribute('aria-checked') === 'false'`, {
              timeoutMs: 30_000,
              label: "Design to Code disabled",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`document.querySelector(${JSON.stringify(SKILL_TOGGLE)})?.getAttribute('aria-checked')`);
            ctx.assert(state === "false", `Expected the skill switch off, received ${state}`);
            await ctx.expectText("设计转代码");
          },
          screenshot: {
            name: "plugin-skill-disabled",
            requireText: ["技能 12", "设计转代码", "Code Connect"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Restore the skill",
      run: async (ctx) => {
        await ctx.prove("The skill can be restored in place", {
          voiceover: vo[2],
          action: async () => {
            await ctx.eval(`(() => {
              const toggle = document.querySelector(${JSON.stringify(SKILL_TOGGLE)});
              toggle?.click();
              return Boolean(toggle);
            })()`);
            await ctx.waitFor(`document.querySelector(${JSON.stringify(SKILL_TOGGLE)})?.getAttribute('aria-checked') === 'true'`, {
              timeoutMs: 30_000,
              label: "Design to Code restored",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`document.querySelector(${JSON.stringify(SKILL_TOGGLE)})?.getAttribute('aria-checked')`);
            ctx.assert(state === "true", `Expected the skill switch on, received ${state}`);
            await ctx.expectText("插件");
          },
          screenshot: {
            name: "plugin-skill-restored",
            requireText: ["技能 12", "设计转代码", "更多能力 13"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Upgrade legacy MCP services to complete plugin packages",
      run: async (ctx) => {
        await ctx.prove("Notion, Linear, Sentry, Stripe, and Context7 install as complete skill-bearing packages", {
          voiceover: vo[3],
          action: async () => {
            await ctx.navigateHash("/settings/extensions");
            await selectPersonalResourceScope(ctx);
            await ctx.waitForText("独立插件包", { timeoutMs: 30_000 });
            for (const service of ["Notion", "Linear", "Sentry", "Stripe", "Context7"]) {
              await installCatalogPlugin(ctx, service);
            }
            await ctx.navigateHash("/settings/extensions/plugin/notion");
            await ctx.waitFor("document.body.innerText.includes('技能 4') && document.body.innerText.includes('连接 Notion')", {
              timeoutMs: 30_000,
              label: "Notion complete plugin detail and MCP authorization",
            });
          },
          assert: async () => {
            await ctx.expectText("Notion 官方远程 MCP");
            await ctx.expectText("技能 4");
            await ctx.expectText("连接 Notion");
            await ctx.expectText("知识检索");
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "plugin-migrated-notion-detail",
            requireText: ["Notion", "应用 1", "技能 4", "连接 Notion", "知识检索"],
            rejectText: ["独立插件包", "Something went wrong"],
            hashIncludes: "/settings/extensions/plugin/notion",
          },
        });
      },
    },
    {
      name: "Install GitHub from the official plugin catalog",
      run: async (ctx) => {
        await ctx.prove("The development client exposes GitHub next to Figma and installs it as an official package", {
          voiceover: vo[4],
          action: async () => {
            await ctx.navigateHash("/settings/extensions");
            await selectPersonalResourceScope(ctx);
            await ctx.waitForText("独立插件包", { timeoutMs: 30_000 });
            const installed = await ctx.eval(`(() => {
              const buttons = [...document.querySelectorAll('button')];
              const alreadyInstalled = buttons.some((entry) => {
                if (!['授权连接', '打开'].includes(entry.textContent?.trim() ?? '')) return false;
                let parent = entry.parentElement;
                while (parent && parent !== document.body) {
                  const value = parent.innerText ?? '';
                  if (value.includes('GitHub') && !value.includes('Figma')) return true;
                  parent = parent.parentElement;
                }
                return false;
              });
              if (alreadyInstalled) return true;
              const button = buttons.find((entry) => {
                if (entry.textContent?.trim() !== '安装') return false;
                let parent = entry.parentElement;
                while (parent && parent !== document.body) {
                  const value = parent.innerText ?? '';
                  if (value.includes('GitHub') && !value.includes('Figma')) return true;
                  parent = parent.parentElement;
                }
                return false;
              });
              button?.click();
              return Boolean(button);
            })()`);
            ctx.assert(installed, "Could not find the GitHub install button");
            await ctx.waitFor("document.body.innerText.includes('GitHub') && /已安装(?:[7-9]|[1-9]\\d+)个/.test(document.body.innerText)", {
              timeoutMs: 45_000,
              label: "GitHub installed in plugin catalog",
            });
          },
          assert: async () => {
            await ctx.expectText("Figma");
            await ctx.expectText("GitHub");
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "plugin-github-installed",
            requireText: ["独立插件包", "Figma", "GitHub"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions",
          },
        });
      },
    },
    {
      name: "Open GitHub as a dedicated plugin detail",
      run: async (ctx) => {
        await ctx.prove("GitHub has a complete detail page with one app, four skills, authorization, metadata, and uninstall", {
          voiceover: vo[5],
          action: async () => {
            const opened = await ctx.eval(`(() => {
              const buttons = [...document.querySelectorAll('button')];
              const button = buttons.find((entry) => {
                if (entry.textContent?.trim() !== '授权连接') return false;
                let parent = entry.parentElement;
                while (parent && parent !== document.body) {
                  const value = parent.innerText ?? '';
                  if (value.includes('GitHub') && !value.includes('Figma')) return true;
                  parent = parent.parentElement;
                }
                return false;
              });
              button?.click();
              return Boolean(button);
            })()`);
            ctx.assert(opened, "Could not find the GitHub detail action");
            await ctx.waitFor("document.body.innerText.includes('技能 4') && document.body.innerText.includes('Publish Changes')", {
              timeoutMs: 30_000,
              label: "GitHub plugin detail",
            });
          },
          assert: async () => {
            await ctx.expectText("应用 1");
            await ctx.expectText("技能 4");
            await ctx.expectText("Review Follow-up");
            await ctx.expectText("CI Debug");
            await ctx.expectText("Publish Changes");
            await ctx.expectText("iPolloWork");
            await ctx.expectText("开发者工具");
            await ctx.expectText("卸载插件");
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "plugin-github-detail",
            requireText: ["GitHub", "应用 1", "技能 4", "连接 GitHub", "Publish Changes", "iPolloWork", "卸载插件"],
            rejectText: ["独立插件包", "Something went wrong"],
            hashIncludes: "/settings/extensions/plugin/github",
          },
        });
      },
    },
    {
      name: "Open the complete plugin import flow",
      run: async (ctx) => {
        await ctx.prove("The plugin list exposes a visible complete-package import action instead of a hidden path field", {
          voiceover: vo[6],
          action: async () => {
            await ctx.navigateHash("/settings/extensions");
            await ctx.waitForText("独立插件包", { timeoutMs: 30_000 });
            const openedExistingFixture = await ctx.eval(pluginCardActionExpression("Community Notes", ["打开", "Open"], true));
            if (openedExistingFixture) {
              await ctx.waitFor("location.hash.includes('/settings/extensions/plugin/fraimz-community-notes')", {
                timeoutMs: 15_000,
                label: "existing import fixture detail",
              });
              await ctx.waitForText("卸载插件", { timeoutMs: 15_000 });
              await clickExactButton(ctx, "卸载插件");
              await ctx.waitFor("location.hash.endsWith('/settings/extensions') && !document.body.innerText.includes('Community Notes')", {
                timeoutMs: 30_000,
                label: "existing import fixture removed",
              });
            }
            await clickExactButton(ctx, "导入插件");
            await ctx.waitForText("导入完整插件包", { timeoutMs: 30_000 });
          },
          assert: async () => {
            await ctx.expectText("选择 iPolloWork 插件包");
            await ctx.expectText("选择文件");
            await ctx.expectNoText("工作区内的路径");
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "plugin-import-empty",
            requireText: ["导入完整插件包", "选择 iPolloWork 插件包", "选择文件"],
            rejectText: ["工作区内的路径", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Preview a declarative developer plugin",
      run: async (ctx) => {
        await ctx.prove("A developer archive is inspected and identified as declarative before installation", {
          voiceover: vo[7],
          action: async () => {
            await choosePluginPackage(ctx, IMPORT_FIXTURE);
            await ctx.waitFor(`document.body.innerText.includes('Community Notes')
              && document.body.innerText.includes('声明式安全检查')
              && [...([...document.querySelectorAll('[role="dialog"]')].at(-1)?.querySelectorAll('button') ?? [])]
                .some((entry) => ['安装插件', '更新'].includes(entry.textContent?.trim() ?? ''))`, {
              timeoutMs: 45_000,
              label: "declarative plugin preview",
            });
          },
          assert: async () => {
            await ctx.expectText("Community Notes");
            await ctx.expectText("声明式安全检查");
            await ctx.expectText("不会加载本地服务");
            await ctx.expectText("安装插件");
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "plugin-import-preview",
            requireText: ["导入完整插件包", "Community Notes", "声明式安全检查", "安装插件"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Install the imported developer plugin",
      run: async (ctx) => {
        await ctx.prove("The inspected package installs and opens as a dedicated plugin detail", {
          voiceover: vo[8],
          action: async () => {
            const installed = await ctx.eval(`(() => {
              const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1);
              const button = [...(dialog?.querySelectorAll('button') ?? [])].find((entry) => ['安装插件', '更新'].includes(entry.textContent?.trim() ?? ''));
              button?.click();
              return Boolean(button);
            })()`);
            ctx.assert(installed, "Could not find the imported plugin install action inside the import dialog");
            await ctx.waitFor("location.hash.includes('/settings/extensions/plugin/fraimz-community-notes') && document.body.innerText.includes('技能 1')", {
              timeoutMs: 45_000,
              label: "imported plugin detail",
            });
          },
          assert: async () => {
            await ctx.expectText("Community Notes");
            await ctx.expectText("技能 1");
            await ctx.expectText("Fraimz Developer");
            await ctx.expectText("卸载插件");
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "plugin-import-installed",
            requireText: ["Community Notes", "技能 1", "Fraimz Developer", "卸载插件"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions/plugin/fraimz-community-notes",
          },
        });
      },
    },
    {
      name: "Uninstall the imported developer plugin",
      run: async (ctx) => {
        await ctx.prove("Uninstall removes the imported package and returns to the plugin list", {
          voiceover: vo[9],
          action: async () => {
            await clickExactButton(ctx, "卸载插件");
            await ctx.waitFor("location.hash.endsWith('/settings/extensions') && !document.body.innerText.includes('Community Notes')", {
              timeoutMs: 45_000,
              label: "imported plugin removed",
            });
          },
          assert: async () => {
            await ctx.expectText("独立插件包");
            await ctx.expectNoText("Community Notes");
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "plugin-import-uninstalled",
            requireText: ["独立插件包", "导入插件"],
            rejectText: ["Community Notes", "Something went wrong"],
            hashIncludes: "/settings/extensions",
          },
        });
      },
    },
    {
      name: "Group independent Video skills without taking ownership",
      run: async (ctx) => {
        await ctx.prove("Video shows detected HyperFrames capabilities as related skills without managing their lifecycle", {
          voiceover: vo[10],
          action: async () => {
            await ctx.navigateHash("/settings/extensions");
            await selectPersonalResourceScope(ctx);
            await ctx.waitForText("独立插件包", { timeoutMs: 30_000 });

            const updateStarted = await ctx.eval(pluginCardActionExpression("iPolloWork Video Agent", ["更新", "Update"], true));
            if (updateStarted) {
              await ctx.waitFor(pluginCardActionExpression("iPolloWork Video Agent", ["打开", "Open"]), {
                timeoutMs: 45_000,
                label: "Video Agent updated",
              });
            }

            const opened = await ctx.eval(pluginCardActionExpression("iPolloWork Video Agent", ["打开", "Open"], true));
            ctx.assert(opened, "Could not find the Video Agent detail action");
            await ctx.waitFor("document.body.innerText.includes('相关技能 9') && document.body.innerText.includes('hyperframes-cli')", {
              timeoutMs: 30_000,
              label: "Video related skills",
            });
            await ctx.eval(`(() => {
              const heading = [...document.querySelectorAll('h1,h2,h3,h4')].find((node) => node.textContent?.includes('相关技能'));
              heading?.scrollIntoView({ block: 'center' });
            })()`);
          },
          assert: async () => {
            await ctx.expectText("技能 2");
            await ctx.expectText("相关技能 9");
            await ctx.expectText("此插件不会安装、停用、更新或删除它们");
            await ctx.expectText("hyperframes-cli");
            await ctx.expectText("media-use");
            await ctx.expectText("product-launch-video");
            const relatedSwitchCount = await ctx.eval(`(() => {
              const heading = [...document.querySelectorAll('h1,h2,h3,h4')].find((node) => node.textContent?.includes('相关技能'));
              return heading?.parentElement?.querySelectorAll('[role="switch"]').length ?? -1;
            })()`);
            ctx.assert(relatedSwitchCount === 0, `Expected related skills to have no lifecycle switches, received ${relatedSwitchCount}`);
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "plugin-video-related-skills",
            requireText: ["技能 2", "相关技能 9", "hyperframes-cli", "media-use", "product-launch-video"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions/plugin/video-agent",
          },
        });
      },
    },
    {
      name: "Use the official Figma Desktop MCP",
      run: async (ctx) => {
        await ctx.prove("Figma uses its official Desktop MCP endpoint without remote OAuth client registration", {
          voiceover: vo[11],
          action: async () => {
            await ctx.navigateHash("/settings/extensions");
            const updateStarted = await ctx.eval(pluginCardActionExpression("Figma", ["更新", "Update"], true));
            if (updateStarted) {
              await ctx.waitFor(pluginCardActionExpression("Figma", ["授权连接", "打开", "Connect", "Open"]), {
                timeoutMs: 45_000,
                label: "Figma Desktop MCP package updated",
              });
            }
            const opened = await ctx.eval(pluginCardActionExpression("Figma", ["授权连接", "打开", "Connect", "Open"], true));
            ctx.assert(opened, "Could not find the Figma detail action");
            await ctx.waitForText("Figma 官方 Desktop MCP", { timeoutMs: 30_000 });
            await ctx.waitForText("连接 Figma Desktop", { timeoutMs: 30_000 });
            await clickExactButton(ctx, "连接 Figma Desktop");
            await ctx.waitFor(`
              document.body.innerText.includes('未检测到 Figma Desktop MCP')
                || document.body.innerText.includes('已连接 Figma Desktop MCP')
            `, {
              timeoutMs: 30_000,
              label: "Figma Desktop MCP connection result is visible",
            });
          },
          assert: async () => {
            await ctx.expectText("Figma 官方 Desktop MCP");
            await ctx.expectText("Figma 桌面应用中已登录的账号");
            await ctx.expectText("连接 Figma Desktop");
            await ctx.expectText("查看官方设置指南");
            await ctx.expectText("切换到 Dev Mode");
            const visibleResult = await ctx.eval(`
              document.body.innerText.includes('未检测到 Figma Desktop MCP')
                || document.body.innerText.includes('已连接 Figma Desktop MCP')
            `);
            ctx.assert(visibleResult, "Expected a visible Figma Desktop MCP connection result");
            await ctx.expectNoText("Unexpected server error");
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "plugin-figma-desktop-mcp",
            requireText: ["Figma", "Figma 官方 Desktop MCP", "连接 Figma Desktop", "查看官方设置指南"],
            rejectText: ["Unexpected server error", "Something went wrong"],
            hashIncludes: "/settings/extensions/plugin/figma",
          },
        });
      },
    },
  ],
};
