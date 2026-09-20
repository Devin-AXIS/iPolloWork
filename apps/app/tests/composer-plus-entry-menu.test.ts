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
  test("routes files, templates, plugins, MCP settings, and agents from one list", () => {
    const templateLabelIndex = composerSource.indexOf('t("composer.plus_use_template")');
    const templateButtonStart = composerSource.lastIndexOf("<button", templateLabelIndex);
    const templateButtonEnd = composerSource.indexOf("</button>", templateButtonStart);
    expect(templateButtonStart).toBeGreaterThan(-1);
    expect(templateButtonEnd).toBeGreaterThan(templateButtonStart);
    const templateButton = composerSource.slice(templateButtonStart, templateButtonEnd);

    expect(composerSource).toContain("plusMenuOpen");
    expect(composerSource).not.toContain("plusMenuSection");
    expect(composerSource).toContain('title={t("composer.plus_menu_label")}');
    expect(composerSource).toContain('t("composer.plus_attach_files")');
    expect(composerSource).toContain('t("composer.plus_use_template")');
    expect(templateButton).toContain('min-h-8 w-full');
    expect(templateButton).toContain('text-[12px]');
    expect(templateButton).toContain('font-medium text-gray-12 transition-colors hover:bg-gray-3');
    expect(templateButton).toContain('<TemplateIcon className="size-3 opacity-60" />');
    expect(templateButton).toContain("setPlusMenuOpen(false)");
    expect(composerSource).toContain('t("composer.extensions_label")');
    expect(composerSource).toContain('t("composer.mcps_label")');
    expect(composerSource).toContain('t("composer.external_agents_label")');
    expect(composerSource).toContain("input?.click()");
    expect(composerSource).toContain("props.onOpenTemplateMarket?.()");
    expect(composerSource).toContain('onClick={() => applyExtensionSelection(entry)}');
    expect(composerSource).toContain('onClick={() => applyExternalAgentSelection(agent)}');
    expect(composerSource).not.toContain('data-testid="composer-extensions-menu"');
  });

  test("keeps the plus icon as the unified menu entry", () => {
    const actionRow = actionRowSource();

    expect(actionRow).toContain('<Plus size={16} strokeWidth={1.75} />');
    expect(actionRow.match(/<Plus size=\{16\}/g)).toHaveLength(1);
    expect(actionRow).toContain('<Paperclip className="size-3.5 text-gray-9"');
    expect(actionRow).toContain('className="flex min-w-0 flex-1 flex-nowrap items-center gap-0 overflow-visible"');
    expect(actionRow).not.toContain("flex-wrap");
    expect(actionRow).toContain('className="relative me-2 shrink-0"');
    expect(actionRow).toContain("inline-flex size-8 shrink-0 items-center justify-center rounded-full");
    expect(actionRow).not.toContain('props.layout === "inline" ? "h-8 px-2"');
    expect(actionRow).not.toContain('title={t("composer.tools_label")}');
    expect(actionRow).not.toContain('title={t("composer.agent_label")}');
    expect(composerSource).not.toContain('["agents", t("composer.agents_label")]');
  });

  test("orders the flat list by section and bounds its height", () => {
    const actionRow = actionRowSource();
    const addHeadingIndex = actionRow.indexOf('t("composer.plus_section_add")');
    const filesIndex = actionRow.indexOf('t("composer.plus_attach_files")');
    const templatesIndex = actionRow.indexOf('t("composer.plus_use_template")');
    const pluginsIndex = actionRow.indexOf('t("composer.extensions_label")');
    const mcpIndex = actionRow.indexOf('t("composer.mcps_label")');
    const agentsIndex = actionRow.indexOf('t("composer.external_agents_label")');

    expect(filesIndex).toBeGreaterThan(addHeadingIndex);
    expect(templatesIndex).toBeGreaterThan(filesIndex);
    expect(pluginsIndex).toBeGreaterThan(templatesIndex);
    expect(agentsIndex).toBeGreaterThan(pluginsIndex);
    expect(mcpIndex).toBeGreaterThan(agentsIndex);
    expect(actionRow).toContain('data-testid="composer-plus-menu"');
    expect(actionRow).toContain('max-h-[min(56dvh,26rem)] w-[min(24rem,calc(100cqw-2rem))]');
    expect(actionRow).not.toContain('shadow-[var(--dls-shell-shadow)]');
    expect(actionRow).toContain('min-h-8 w-full items-center gap-2');
  });

  test("keeps the list open for internal clicks and closes on outside clicks", () => {
    const outsideClickHandler = plusMenuOutsideClickHandlerSource();

    expect(outsideClickHandler).toContain("plusMenuRef.current?.contains(target)");
    expect(outsideClickHandler).not.toContain("toolMenuRef");
    expect(outsideClickHandler).not.toContain("delegationMenuRef");
  });

  test("discovers enabled external subagents from plugin package capabilities", () => {
    expect(sessionSurfaceSource).toContain("listPluginPackages(props.workspaceId)");
    expect(sessionSurfaceSource).toContain("filter(isDelegatableExternalAgent)");
    expect(composerSource).toContain("item.manifest.composer?.prompt");
    expect(composerSource).toContain("applyExternalAgentSelection(agent)");
  });

  test("shows plugin and MCP items in the same list while keeping slash loading", () => {
    const menu = actionRowSource();
    expect(menu).toContain('data-testid="composer-plus-menu"');
    expect(menu).toContain('composerExtensions.map((entry)');
    expect(menu).toContain('activeMcpItems.map(({ entry, status })');
    expect(menu).toContain('externalAgents.map((agent)');
    expect(menu).not.toContain('["commands",');
    expect(menu).not.toContain('["skills",');
    expect(composerSource).not.toContain("ToolMenuSection");
    expect(composerSource).toContain('if (!slashOpen) return;');
    expect(composerSource).toContain('[slashOpen, loadCommands]');
    expect(composerSource).toContain('applySkillSelection(command.name, options)');
    expect(composerSource).not.toContain('toolMenuLoadRef.current.commands');
    expect(composerSource).not.toContain('toolMenuLoadRef.current.skills');
  });

  test("loads the extension menu from installed and ready plugin packages", () => {
    expect(sessionSurfaceSource).toContain("listPlusMenuData");
    expect(sessionSurfaceSource).toContain("isPluginPackageReady");
    expect(composerSource).toContain("props.listPlusMenuData");
    expect(composerSource).toContain("plusMenuData?.extensions");
    expect(composerSource).not.toContain("IPOLLOWORK_EXTENSION_CATALOG");
  });

  test("uses each plugin's displayed icon and matches the template and attachment icon sizes", () => {
    expect(composerSource).toContain("pluginId: entry.pluginId");
    expect(composerSource).toContain("extensionIcon(entry, 16)");
    expect(composerSource).not.toContain("disabled:opacity-60\" onClick={() => applyExtensionSelection(entry)}");
    expect(composerSource).toContain('<Paperclip className="size-3.5 text-gray-9"');
    expect(composerSource).toContain('<TemplateIcon className="size-3 opacity-60" />');
  });

  test("refreshes one scoped menu snapshot and marks previous or unavailable status", () => {
    expect(sessionSurfaceSource).toContain("const [response, packageResponse] = await Promise.all([");
    expect(sessionPageSource).toContain("const [response, packageResponse] = await Promise.all([");
    expect(composerSource).toContain("if (!cancelled) setPlusMenuLoadState(\"error\")");
    expect(composerSource).toContain("plusMenuSnapshot?.scope === props.plusMenuScope");
    expect(composerSource).toContain("disabled={!menuDataReady}");
    expect(composerSource).toContain('"composer.plus_previous_failed"');
    expect(composerSource).toContain('t("composer.plus_status_unavailable")');
  });

  test("scopes an extension workbench without forcing an unrelated tool path", () => {
    expect(composerSource).toContain("props.onOpenWorkspaceApp?.(entry.pluginId)");
    expect(sessionSurfaceSource).toContain("onOpenWorkspaceApp={props.onOpenWorkspaceApp}");
    expect(sessionPageSource).toContain("openWorkspaceAppForPlugin");
    expect(sessionPageSource).toContain("mediaStudioEngine(entry) === pluginId");
    expect(sessionPageSource).toContain("onOpenWorkspaceApp={openWorkspaceAppForPlugin}");
    expect(sessionPageSource).toContain('source?.type !== "workspace-app"');
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

  test("does not scope ordinary chat sends to an open workbench", () => {
    const start = sessionPageSource.indexOf("const sendSessionDraft = useCallback(");
    expect(start).toBeGreaterThan(-1);
    // The complete callback ends at its dependency list, before the next hook.
    const callbackEnd = sessionPageSource.indexOf("\n  }, [", start);
    const sendDraft = sessionPageSource.slice(start, callbackEnd);
    expect(sendDraft).toContain("mergePluginWorkshopInstruction");
    expect(sendDraft).not.toContain("workspaceAppCapabilityInstruction");
    expect(sendDraft).not.toContain('type === "workspace-app"');
    const workbenchSend = sessionPageSource.slice(sessionPageSource.indexOf("const sendWorkspaceAppMessage = useCallback("));
    expect(workbenchSend).toContain("workspaceAppCapabilityInstruction");
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
