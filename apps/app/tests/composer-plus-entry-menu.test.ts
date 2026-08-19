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
  test("routes files, tools, and external delegation from one plus menu", () => {
    expect(composerSource).toContain("plusMenuOpen");
    expect(composerSource).toContain("plusMenuSection");
    expect(composerSource).toContain('title={t("composer.plus_menu_label")}');
    expect(composerSource).toContain('t("composer.plus_attach_files")');
    expect(composerSource).toContain('t("composer.plus_tools")');
    expect(composerSource).toContain('t("composer.delegate_external_agents")');
    expect(composerSource).toContain("fileInput?.click()");
    expect(composerSource).toContain('onMouseEnter={() => setPlusMenuSection("tools")}');
    expect(composerSource).toContain('onMouseEnter={() => setPlusMenuSection("delegation")}');
    expect(composerSource).toContain('plusMenuSection === "tools"');
    expect(composerSource).toContain('plusMenuSection === "delegation"');
    expect(composerSource).toContain('<ChevronRight size={14}');
  });

  test("keeps the plus icon as the unified menu entry", () => {
    const actionRow = actionRowSource();

    expect(actionRow).toContain('<Plus size={18} />');
    expect(actionRow).not.toContain("<Paperclip");
    expect(actionRow).toContain('className="flex min-w-0 flex-1 flex-wrap items-center gap-0 overflow-visible"');
    expect(actionRow).toContain('className="relative me-1.5"');
    expect(actionRow).toContain('props.layout === "inline" ? "h-8 px-2"');
    expect(actionRow).not.toContain('title={t("composer.tools_label")}');
    expect(actionRow).not.toContain('title={t("composer.agent_label")}');
    expect(composerSource).not.toContain('["agents", t("composer.agents_label")]');
  });

  test("orders plus menu entries as files, tools, then delegation", () => {
    const actionRow = actionRowSource();
    const filesIndex = actionRow.indexOf('t("composer.plus_attach_files")');
    const toolsIndex = actionRow.indexOf('t("composer.plus_tools")');
    const delegationIndex = actionRow.indexOf('t("composer.delegate_external_agents")');

    expect(filesIndex).toBeGreaterThan(-1);
    expect(toolsIndex).toBeGreaterThan(filesIndex);
    expect(delegationIndex).toBeGreaterThan(toolsIndex);
  });

  test("keeps the plus menu open while interacting with tool and delegation submenus", () => {
    const outsideClickHandler = plusMenuOutsideClickHandlerSource();

    expect(outsideClickHandler).toContain("toolMenuRef.current?.contains(target)");
    expect(outsideClickHandler).toContain("delegationMenuRef.current?.contains(target)");
  });

  test("discovers enabled external subagents from plugin package capabilities", () => {
    expect(sessionSurfaceSource).toContain("listPluginPackages(props.workspaceId)");
    expect(sessionSurfaceSource).toContain('resource.provides?.includes("service:external-subagent")');
    expect(sessionSurfaceSource).toContain("!item.disabledResourceIds.includes(resource.id)");
    expect(composerSource).toContain("item.manifest.composer?.prompt");
    expect(composerSource).toContain("applyExternalAgentSelection(agent)");
  });

  test("presents DeepSeek Harness as collaboration without implementation details", () => {
    expect(deepSeekManifestSource).toContain("把代码审查、开发和研究任务委派给 DeepSeek Harness 协作完成。");
    expect(deepSeekManifestSource).toContain("请使用 DeepSeek Harness 协作完成以下任务：");
    expect(deepSeekManifestSource).toContain('"simpleIconSlug": "deepseek"');
    expect(deepSeekManifestSource).not.toContain("不替换 OpenCode");
    expect(deepSeekManifestSource).not.toContain("隔离运行");
    expect(deepSeekManifestSource).not.toContain("原工作区");
    expect(deepSeekManifestSource).not.toContain("primary agent");
    expect(deepSeekManifestSource).not.toContain("isolated external subagent");
  });
});
