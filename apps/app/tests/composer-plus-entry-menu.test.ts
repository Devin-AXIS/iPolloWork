import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const composerSource = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/surface/composer/composer.tsx"),
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
  test("routes files, tools, and agents from one plus menu", () => {
    expect(composerSource).toContain("plusMenuOpen");
    expect(composerSource).toContain("plusMenuSection");
    expect(composerSource).toContain('title={t("composer.plus_menu_label")}');
    expect(composerSource).toContain('t("composer.plus_attach_files")');
    expect(composerSource).toContain('t("composer.plus_tools")');
    expect(composerSource).toContain('t("composer.plus_agents")');
    expect(composerSource).toContain("fileInput?.click()");
    expect(composerSource).toContain('onMouseEnter={() => setPlusMenuSection("tools")}');
    expect(composerSource).toContain('onMouseEnter={() => setPlusMenuSection("agents")}');
    expect(composerSource).toContain('plusMenuSection === "tools"');
    expect(composerSource).toContain('plusMenuSection === "agents"');
    expect(composerSource).toContain('<ChevronRight size={14}');
  });

  test("removes the old standalone attachment, tool, and agent entries", () => {
    const actionRow = actionRowSource();

    expect(actionRow).toContain("<Plus");
    expect(actionRow).not.toContain("<Paperclip");
    expect(actionRow).not.toContain('title={t("composer.tools_label")}');
    expect(actionRow).not.toContain('title={t("composer.agent_label")}');
    expect(composerSource).not.toContain('["agents", t("composer.agents_label")]');
  });

  test("orders plus menu entries as files, tools, then agents", () => {
    const actionRow = actionRowSource();
    const filesIndex = actionRow.indexOf('t("composer.plus_attach_files")');
    const toolsIndex = actionRow.indexOf('t("composer.plus_tools")');
    const agentsIndex = actionRow.indexOf('t("composer.plus_agents")');

    expect(filesIndex).toBeGreaterThan(-1);
    expect(toolsIndex).toBeGreaterThan(filesIndex);
    expect(agentsIndex).toBeGreaterThan(toolsIndex);
  });

  test("keeps the plus menu open while interacting with tool and agent submenus", () => {
    const outsideClickHandler = plusMenuOutsideClickHandlerSource();

    expect(outsideClickHandler).toContain("toolMenuRef.current?.contains(target)");
    expect(outsideClickHandler).toContain("agentMenuRef.current?.contains(target)");
  });
});
