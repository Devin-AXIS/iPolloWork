import { readFile, writeFile } from "node:fs/promises";

import { storedZip } from "../runner/stored-zip.mjs";

export async function writeUnifiedEnginePluginFixture(input) {
  const manifest = {
    schemaVersion: 2,
    id: input.pluginId,
    name: input.pluginName,
    description: "验证同一全局插件在 OpenCode 与 DeepSeek Harness 中共享 Skill、MCP、命令、Agent 和 Workspace App。",
    category: "开发者工具",
    source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false },
    package: {
      version: "1.0.0",
      publisher: { id: "fraimz", name: "Fraimz Runtime Proof" },
      compatibility: { ipollowork: ">=0.21.0" },
      updateId: `fraimz/${input.pluginId}`,
    },
    resources: [
      {
        type: "skill",
        id: "unified-runtime-skill",
        label: "统一插件工作流",
        description: "在当前引擎中验证插件工作流。",
        path: "skills/unified-runtime/SKILL.md",
        required: true,
      },
      {
        type: "mcp",
        id: "unified-runtime-mcp",
        label: "统一运行时 MCP",
        description: "用于验证 MCP 配置会投影到当前引擎。",
        path: "mcp/unified-runtime.json",
        mcpServerName: input.pluginId,
        oauth: false,
        required: true,
      },
      {
        type: "command",
        id: "unified-runtime-command",
        label: "验证统一插件",
        description: "验证安装插件命令可以在当前引擎中运行。",
        path: "commands/verify-unified-plugin.md",
        required: true,
      },
      {
        type: "agent",
        id: "unified-runtime-agent",
        label: "统一插件审查 Agent",
        description: "检查插件能力是否完整。",
        path: "agents/unified-plugin-reviewer.md",
        required: true,
      },
      {
        type: "ui",
        id: "unified-board",
        label: input.workspaceAppLabel,
        description: "通过标准 MCP App 工具与对话协作的右侧画板。",
        path: "ui/board.html",
        required: true,
        ui: {
          uri: `ui://${input.pluginId}/board`,
          mimeType: "text/html;profile=mcp-app",
          prefersBorder: false,
        },
      },
    ],
    contributions: [{
      type: "workspace-app",
      ref: "unified-board",
      label: input.workspaceAppLabel,
      description: "在右侧工作区打开统一插件画板。",
    }],
  };
  const canvasHtml = (await readFile(new URL("../../examples/plugin-packages/workspace-canvas/ui/canvas.html", import.meta.url), "utf8"))
    .replaceAll("Workspace Canvas", input.workspaceAppLabel)
    .replace("Current canvas:", "Current unified board:");
  await writeFile(input.path, storedZip({
    [`${input.pluginId}/ipollowork.plugin.json`]: JSON.stringify(manifest, null, 2),
    [`${input.pluginId}/skills/unified-runtime/SKILL.md`]: "---\nname: unified-runtime\ndescription: Verify one installed plugin across supported engines.\n---\n\n# Unified runtime\n\nUse the installed plugin capabilities without engine-specific setup.\n",
    [`${input.pluginId}/mcp/unified-runtime.json`]: JSON.stringify({
      type: "remote",
      url: "https://127.0.0.1:9/mcp",
      enabled: true,
      oauth: false,
    }, null, 2),
    [`${input.pluginId}/commands/verify-unified-plugin.md`]: "Verify that the installed plugin Skill, MCP, Agent, and Workspace App are available in the current engine.\n",
    [`${input.pluginId}/agents/unified-plugin-reviewer.md`]: "Review the active plugin capabilities and report any engine-specific gap.\n",
    [`${input.pluginId}/ui/board.html`]: canvasHtml,
  }));
}
