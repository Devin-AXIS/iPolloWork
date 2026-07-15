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
  const end = composerSource.indexOf("<ModelSelect", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return composerSource.slice(start, end);
}

function busyActionSource() {
  const start = composerSource.indexOf("{props.busy ? (");
  const end = composerSource.indexOf(") : (", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return composerSource.slice(start, end);
}

describe("composer plus entry menu", () => {
  test("routes the attachment, tool, and agent entries from one plus menu", () => {
    expect(composerSource).toContain("plusMenuOpen");
    expect(composerSource).toContain("plusMenuSection");
    expect(composerSource).toContain('title={t("composer.plus_menu_label")}');
    expect(composerSource).toContain('t("composer.plus_tools")');
    expect(composerSource).toContain('t("composer.plus_attach_files")');
    expect(composerSource).toContain('t("composer.plus_agents")');
    expect(composerSource).toContain('setPlusMenuSection("tools")');
    expect(composerSource).toContain("fileInput?.click()");
    expect(composerSource).toContain('setPlusMenuSection("agents")');
    expect(composerSource).toContain('plusMenuSection === "tools"');
    expect(composerSource).toContain('plusMenuSection === "agents"');
    expect(composerSource).not.toContain('["agents", t("composer.agents_label")]');
  });

  test("does not leave the old attachment or tool buttons as separate action-row entries", () => {
    const actionRow = actionRowSource();

    expect(actionRow).toContain("<Plus");
    expect(actionRow).not.toContain('title={props.attachmentsDisabledReason ?? t("composer.attach_files")}');
    expect(actionRow).not.toContain('title={t("composer.tools_label")}');
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

  test("busy composer shows stop without send or queued follow-up controls", () => {
    const busyAction = busyActionSource();

    expect(busyAction).toContain("props.onStop");
    expect(busyAction).toContain('t("composer.stop")');
    expect(busyAction).not.toContain("props.onSteer");
    expect(busyAction).not.toContain("props.onQueue");
    expect(busyAction).not.toContain('t("composer.steer")');
    expect(busyAction).not.toContain('t("composer.queue")');
    expect(composerSource).not.toContain("props.onSteer");
    expect(composerSource).not.toContain("props.onQueue");
  });
});
