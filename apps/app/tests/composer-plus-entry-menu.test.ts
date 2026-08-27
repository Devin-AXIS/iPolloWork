import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const composerSource = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/surface/composer/composer.tsx"),
  "utf8",
);
const sessionSurfaceSource = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/surface/session-surface.tsx"),
  "utf8",
);
const sessionPageSource = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/chat/session-page.tsx"),
  "utf8",
);
const deepSeekManifestSource = readFileSync(
  resolve(import.meta.dir, "../../../examples/plugin-packages/deepseek-harness/ipollowork.plugin.json"),
  "utf8",
);

function actionRowSource() {
  const marker = "{/* Action row";
  const start = composerSource.indexOf(marker);
  const end = composerSource.indexOf("<ModelBehaviorMenu", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return composerSource.slice(start, end);
}

function plusMenuOutsideClickHandlerSource() {
  const start = composerSource.indexOf("const handlePointerDown = (event: MouseEvent) =>", composerSource.indexOf("if (!plusMenuOpen) return;"));
  const end = composerSource.indexOf("window.addEventListener(\"mousedown\", handlePointerDown);", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return composerSource.slice(start, end);
}

describe("composer plus entry menu", () => {
  test("routes files, templates, tools, and external delegation from one plus menu", () => {
    const templateLabelIndex = composerSource.indexOf('t("composer.plus_use_template")');
    const templateButtonStart = composerSource.lastIndexOf("<button", templateLabelIndex);
    const templateButtonEnd = composerSource.indexOf("</button>", templateButtonStart);
    expect(templateButtonStart).toBeGreaterThan(-1);
    expect(templateButtonEnd).toBeGreaterThan(templateButtonStart);
    const templateButton = composerSource.slice(templateButtonStart, templateButtonEnd);

    expect(composerSource).toContain("plusMenuOpen");
    expect(composerSource).toContain("plusMenuSection");
    expect(composerSource).toContain('title={t("composer.plus_menu_label")}');
    expect(composerSource).toContain('t("composer.plus_attach_files")');
    expect(composerSource).toContain('t("composer.plus_use_template")');
    expect(templateButton).toContain('text-gray-11 transition-colors hover:bg-gray-3 hover:text-gray-12');
    expect(templateButton).toContain('<TemplateIcon className="size-3.5 opacity-60" />');
    expect(templateButton).toContain("setPlusMenuSection(null)");
    expect(templateButton).toContain("setToolMenuOpen(false)");
    expect(templateButton).toContain("setDelegationMenuOpen(false)");
    expect(composerSource).toContain('t("composer.plus_tools")');
    expect(composerSource).toContain('t("composer.delegate_external_agents")');
    expect(composerSource).toContain("input?.click()");
    expect(composerSource).toContain("props.onOpenTemplateMarket?.()");
    expect(composerSource).toContain('onMouseEnter={() => setPlusMenuSection("tools")}');
    expect(composerSource).toContain('onMouseEnter={() => setPlusMenuSection("delegation")}');
    expect(composerSource).toContain('plusMenuSection === "tools"');
    expect(composerSource).toContain('plusMenuSection === "delegation"');
    expect(composerSource).toContain('<ChevronRight size={14}');
  });

  test("keeps the plus icon as the unified menu entry", () => {
    const actionRow = actionRowSource();

    expect(actionRow).toContain('<Plus size={18} />');
    expect(actionRow.match(/<Plus size=\{18\} \/>/g)).toHaveLength(1);
    expect(actionRow).toContain('<Paperclip className="size-4 shrink-0 text-gray-9"');
    expect(actionRow).toContain('className="flex min-w-0 flex-1 flex-nowrap items-center gap-0 overflow-visible"');
    expect(actionRow).not.toContain("flex-wrap");
    expect(actionRow).toContain('className="relative me-1.5 shrink-0"');
    expect(actionRow).toContain('props.layout === "inline" ? "h-8 px-2"');
    expect(actionRow).not.toContain('title={t("composer.tools_label")}');
    expect(actionRow).not.toContain('title={t("composer.agent_label")}');
    expect(composerSource).not.toContain('["agents", t("composer.agents_label")]');
  });

  test("orders plus menu entries as files, templates, tools, then delegation", () => {
    const actionRow = actionRowSource();
    const filesIndex = actionRow.indexOf('t("composer.plus_attach_files")');
    const templatesIndex = actionRow.indexOf('t("composer.plus_use_template")');
    const toolsIndex = actionRow.indexOf('t("composer.plus_tools")');
    const delegationIndex = actionRow.indexOf('t("composer.delegate_external_agents")');

    expect(filesIndex).toBeGreaterThan(-1);
    expect(templatesIndex).toBeGreaterThan(filesIndex);
    expect(toolsIndex).toBeGreaterThan(templatesIndex);
    expect(delegationIndex).toBeGreaterThan(toolsIndex);
  });

  test("keeps the plus menu open while interacting with tool and delegation submenus", () => {
    const outsideClickHandler = plusMenuOutsideClickHandlerSource();

    expect(outsideClickHandler).toContain("toolMenuRef.current?.contains(target)");
    expect(outsideClickHandler).toContain("delegationMenuRef.current?.contains(target)");
  });

  test("discovers enabled external subagents from plugin package capabilities", () => {
    expect(sessionSurfaceSource).toContain("listPluginPackages(props.workspaceId)");
    expect(sessionSurfaceSource).toContain("filter(isDelegatableExternalAgent)");
    expect(composerSource).toContain("item.manifest.composer?.prompt");
    expect(composerSource).toContain("applyExternalAgentSelection(agent)");
  });

  test("loads the extension menu from installed and ready plugin packages", () => {
    expect(sessionSurfaceSource).toContain("listInstalledExtensions");
    expect(sessionSurfaceSource).toContain("isPluginPackageReady");
    expect(composerSource).toContain("props.listInstalledExtensions");
    expect(composerSource).toContain("installedExtensions");
    expect(composerSource).not.toContain("IPOLLOWORK_EXTENSION_CATALOG");
  });

  test("scopes an extension workbench without forcing an unrelated tool path", () => {
    expect(composerSource).toContain("props.onOpenWorkspaceApp?.(entry.pluginId)");
    expect(sessionSurfaceSource).toContain("onOpenWorkspaceApp={props.onOpenWorkspaceApp}");
    expect(sessionPageSource).toContain("openWorkspaceAppForPlugin");
    expect(sessionPageSource).toContain("entry.pluginId === pluginId");
    expect(sessionPageSource).toContain("onOpenWorkspaceApp={openWorkspaceAppForPlugin}");
    expect(sessionPageSource).toContain('activePanelTab?.type === "workspace-app"');
    expect(sessionPageSource).toContain("workspaceAppCapabilityInstruction");
    expect(sessionPageSource).toContain("only when this workbench exposes a relevant tool");
    expect(sessionPageSource).toContain("follow that instruction instead");
    expect(sessionPageSource).toContain("Do not inspect or operate unrelated Design");
    expect(sessionPageSource).toContain('const WORKSPACE_APP_LIST_TOOLS_NAME = "ipollowork_workspace_app_list_tools"');
    expect(sessionPageSource).toContain('const WORKSPACE_APP_CALL_TOOL_NAME = "ipollowork_workspace_app_call_tool"');
    expect(sessionPageSource).not.toContain("Call workspace_app.list_tools");
    expect(sessionPageSource).not.toContain("then call workspace_app.call_tool");
    expect(sessionPageSource).not.toContain("You must use its available workspace_app tools");
  });

  test("presents DeepSeek Harness as collaboration without implementation details", () => {
    expect(deepSeekManifestSource).toContain("让 OpenCode 把代码审查、开发和研究任务委派给 DeepSeek Harness 协作完成。");
    expect(deepSeekManifestSource).toContain("请使用 DeepSeek Harness 协作完成以下任务：");
    expect(deepSeekManifestSource).toContain('"engines": ["opencode"]');
    expect(deepSeekManifestSource).toContain('"simpleIconSlug": "deepseek"');
    expect(deepSeekManifestSource).not.toContain("不替换 OpenCode");
    expect(deepSeekManifestSource).not.toContain("隔离运行");
    expect(deepSeekManifestSource).not.toContain("原工作区");
    expect(deepSeekManifestSource).not.toContain("primary agent");
    expect(deepSeekManifestSource).not.toContain("isolated external subagent");
  });
});
