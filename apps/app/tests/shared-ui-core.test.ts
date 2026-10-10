import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as core from "@ipollowork/ui/core";
import { Checkbox } from "../src/components/ui/checkbox";
import { Command } from "../src/components/ui/command";
import { Table } from "../src/components/ui/table";
import { Sheet } from "../src/components/ui/sheet";
import { ToggleGroup } from "../src/components/ui/toggle-group";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ComponentProps } from "react";
import { Button } from "../src/components/ui/button";
import { SettingsNotice } from "../src/react-app/domains/settings/settings-section";

test("host compatibility entries use the same public component implementation", () => {
  expect(Checkbox).toBe(core.Checkbox);
  expect(Command).toBe(core.Command);
  expect(Table).toBe(core.Table);
  expect(Sheet).toBe(core.Sheet);
  expect(ToggleGroup).toBe(core.ToggleGroup);
  expect(Button).toBe(core.Button);
});

test("the public Button supports all audited variants and sizes", () => {
  const variants: NonNullable<ComponentProps<typeof core.Button>["variant"]>[] = ["default", "outline", "secondary", "ghost", "destructive", "link"];
  const sizes: NonNullable<ComponentProps<typeof core.Button>["size"]>[] = ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"];
  for (const variant of variants) for (const size of sizes) {
    const html = renderToStaticMarkup(createElement(core.Button, { variant, size, disabled: true, "aria-label": "按钮", children: "动作" }));
    expect(html).toContain('<button');
    expect(html).toContain('data-slot="button"');
    expect(html).toContain('aria-label="按钮"');
    expect(html).toContain('disabled');
    expect(core.buttonVariants({ variant, size })).toContain('group/button');
  }
});

test("shared alert accepts localized action text without a host translation service", () => {
  const html = renderToStaticMarkup(createElement(core.Alert, {
    onDismiss: () => {}, closeLabel: "关闭提示", children: "保留提示",
  }));
  expect(html).toContain('aria-label="关闭提示"');
  expect(html).toContain("保留提示");
});

test("settings buttons keep typography and decoration out of flex spacing across variants", () => {
  for (const variant of ["secondary", "ghost", "outline"] satisfies ComponentProps<typeof core.Button>["variant"][]) {
    const html = renderToStaticMarkup(createElement(core.ButtonStyleScopeProvider, { value: "settings",
      children: createElement(core.Button, { variant, children: "Configure" }),
    }));
    expect(html).toContain("before:absolute");
    expect(html).toContain("leading-[18px]");
    expect(html).toContain("text-[13px]");
    expect(html).toContain("py-0");
  }
});

test("all feedback background tokens use palette level two", () => {
  const tokens = readFileSync(new URL("../../../packages/ui/src/common/tokens.css", import.meta.url), "utf8");
  for (const [semantic, palette] of [["info", "sky"], ["success", "green"], ["warning", "amber"], ["error", "red"]]) {
    expect(tokens).toContain(`--feedback-${semantic}-background: var(--${palette}-2)`);
  }
});

test("every public Alert variant uses a soft semantic background without a border", () => {
  const cases: [NonNullable<ComponentProps<typeof core.Alert>["variant"]>, string][] = [
    ["default", "info"], ["success", "success"], ["warning", "warning"], ["destructive", "error"],
  ];
  for (const [variant, semantic] of cases) {
    const html = renderToStaticMarkup(createElement(core.Alert, { variant, children: "操作结果" }));
    expect(html).toContain("border-0");
    expect(html).toContain(`bg-feedback-${semantic}`);
    expect(html).not.toMatch(/border-(sky|green|red|amber)-/);
    expect(html).toContain('role="alert"');
  }
});

test("SettingsNotice preserves content while reusing borderless feedback tokens", () => {
  for (const tone of ["neutral", "error"] satisfies ComponentProps<typeof SettingsNotice>["tone"][]) {
    const html = renderToStaticMarkup(createElement(SettingsNotice, { tone, children: "连接失败，输入仍保留" }));
    expect(html).toContain("border-0");
    expect(html).toContain(tone === "error" ? "bg-feedback-error" : "bg-feedback-info");
    expect(html).not.toMatch(/border-(red|dls)-/);
    expect(html).toContain("连接失败，输入仍保留");
  }
});

test("public mapping only names available runtime exports and existing public entries", () => {
  const mapping = JSON.parse(readFileSync(new URL("../../../.codex/skills/ipollowork-plugin-ui/references/component-mapping.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(readFileSync(new URL("../../../packages/ui/package.json", import.meta.url), "utf8"));
  for (const component of mapping.components) {
    expect(Object.hasOwn(core, component.export)).toBe(true);
    for (const name of component.relatedExports ?? []) expect(Object.hasOwn(core, name)).toBe(true);
    expect(Object.hasOwn(pkg.exports, component.package.replace("@ipollowork/ui", "."))).toBe(true);
    expect(readFileSync(new URL("../../../" + component.source, import.meta.url), "utf8")).not.toContain('from "@/');
  }
});
