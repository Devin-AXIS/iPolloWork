import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as core from "@ipollowork/ui/core";
import { Card, CardIcon, CardMeta } from "../src/components/ui/card";
import { requireRuntime } from "@ipollowork/ui/runtime-contract";
import { UI_RUNTIME_VERSION } from "@ipollowork/ui/plugin-runtime";
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
  expect(Card).toBe(core.Card);
  expect(CardIcon).toBe(core.CardIcon);
  expect(CardMeta).toBe(core.CardMeta);
});

test("resource cards preserve semantic titles and named independent footer actions", () => {
  for (const size of ["default", "sm"] satisfies ComponentProps<typeof core.Card>["size"][]) {
    const html = renderToStaticMarkup(createElement(core.Card, { variant: "resource", size, "aria-labelledby": "resource-name" },
      createElement(core.CardHeader, null,
        createElement(core.CardIcon, null, createElement("img", { src: "/resource.svg", alt: "" })),
        createElement("div", null,
          createElement(core.CardTitle, { as: "h3", id: "resource-name" }, "资源名称"),
          createElement(core.CardDescription, null, "资源说明"))),
      createElement(core.CardContent, null, createElement(core.CardMeta, null, "v1.0.0")),
      createElement(core.CardFooter, null, createElement(core.CardMeta, null, "就绪"),
        createElement(core.Button, { children: "打开资源" }))));
    expect(html).toContain('data-variant="resource"');
    expect(html).toContain('aria-labelledby="resource-name"');
    expect(html).toContain('<h3 data-slot="card-title"');
    expect(html).toContain('id="resource-name"');
    expect(html).toContain('data-slot="card-icon"');
    expect(html).toContain('data-slot="card-meta"');
    expect(html).toContain('size-[32px]');
    expect(html).toContain('p-[16px]');
    expect(html.match(/<button /g)).toHaveLength(1);
    expect(html).toContain("打开资源");
  }
});

test("resource row layout keeps a single semantic heading and footer action without a metadata block", () => {
  const html = renderToStaticMarkup(createElement(core.Card, { variant: "resource", layout: "row" },
    createElement(core.CardHeader, null,
      createElement(core.CardIcon, null, createElement("img", { src: "/brand.svg", alt: "" })),
      createElement("div", null, createElement(core.CardTitle, { as: "h3" }, "资源名称"), createElement(core.CardDescription, null, "一句说明"))),
    createElement(core.CardFooter, null, createElement(core.Button, { children: "查看" }))));
  expect(html).toContain('data-layout="row"');
  expect(html).toContain('data-variant="resource"');
  expect(html).toContain('flex-row flex-wrap');
  expect(html).toContain('min-w-[min(100%,240px)]');
  expect(html.match(/<button /g)).toHaveLength(1);
  expect(html).not.toContain('data-slot="card-content"');
  expect(html).not.toContain('data-slot="card-meta"');
});

test("card action menu exposes one named button and preserves disabled state", () => {
  const html = renderToStaticMarkup(createElement(core.CardActionsMenu, { label: "技能操作", disabled: true }, createElement(core.DropdownMenuItem, null, "查看")));
  expect(html.match(/<button /g)).toHaveLength(1);
  expect(html).toContain('aria-label="技能操作"');
  expect(html).toContain('aria-haspopup="menu"');
  expect(html).toContain('disabled');
  expect(html).toContain('lucide-ellipsis');
});

test("ordinary cards retain default and outline presentation without opting into resources", () => {
  const implicit = renderToStaticMarkup(createElement(core.Card, null, createElement(core.CardTitle, null, "默认卡片")));
  const explicit = renderToStaticMarkup(createElement(core.Card, { variant: "default" }, createElement(core.CardTitle, null, "默认卡片")));
  expect(implicit).toBe(explicit);
  expect(implicit).toContain('bg-card');
  expect(implicit).toContain('shadow-md');
  expect(implicit).toContain('rounded-[16px]');
  expect(implicit).toContain('data-variant="default"');
  expect(implicit).not.toContain('<h3');
  const outline = renderToStaticMarkup(createElement(core.Card, { variant: "outline", size: "sm" }));
  expect(outline).toContain('data-variant="outline"');
  expect(outline).toContain('bg-transparent');
  expect(outline).toContain('shadow-none');
  expect(outline).toContain('py-3');
  expect(outline).not.toContain('p-[16px]');
  const ordinaryRow = renderToStaticMarkup(createElement(core.Card, { variant: "outline", layout: "row", size: "sm" }));
  expect(ordinaryRow).toBe(outline);
});

test("resource card capability rejects older minor runtimes and missing companion exports", () => {
  const previousWindow = Reflect.get(globalThis, "window");
  const required = ["Card", "CardHeader", "CardTitle", "CardDescription", "CardIcon", "CardMeta", "CardContent", "CardFooter"] satisfies Parameters<typeof requireRuntime>[1];
  const runtime = { version: UI_RUNTIME_VERSION, ...core };
  try {
    Reflect.set(globalThis, "window", { ipolloworkUi: { ...runtime, version: "1.7.0" } });
    expect(() => requireRuntime(1, required, 8)).toThrow("版本过旧");
    Reflect.set(globalThis, "window", { ipolloworkUi: runtime });
    expect(UI_RUNTIME_VERSION).toBe("1.8.0");
    expect(requireRuntime(1, required, 8)).toBe(runtime);
    Reflect.deleteProperty(runtime, "CardMeta");
    expect(() => requireRuntime(1, required, 8)).toThrow("缺少所需 UI 组件");
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Reflect.set(globalThis, "window", previousWindow);
  }
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

test("flat button scopes preserve focus treatment and do not change ordinary buttons", () => {
  for (const variant of ["default", "outline", "destructive"] satisfies ComponentProps<typeof core.Button>["variant"][]) {
    const ordinary = renderToStaticMarkup(createElement(core.Button, { variant, children: "普通动作" }));
    const flat = renderToStaticMarkup(createElement(core.ButtonStyleScopeProvider, { value: "settings", flat: true,
      children: createElement(core.Button, { variant, children: "企业动作" }),
    }));
    expect(ordinary).toContain("shadow-xs/5");
    expect(flat).not.toContain("shadow-xs/5");
    expect(flat).toContain("before:shadow-none");
    expect(flat).toContain("focus-visible:ring-3");
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

test("feedback backgrounds share palette tokens with a neutral warning notice", () => {
  const tokens = readFileSync(new URL("../../../packages/ui/src/common/tokens.css", import.meta.url), "utf8");
  for (const [semantic, palette] of [["info", "sky"], ["success", "green"], ["error", "red"]]) {
    expect(tokens).toContain(`--feedback-${semantic}-background: var(--${palette}-2)`);
  }
  expect(tokens).toContain("--feedback-warning-background: var(--project-dialog-notice)");
  expect(tokens).toContain("--project-dialog-notice: #f4f4ee");
  expect(tokens).toMatch(/\[data-theme="dark"\]\s*\{[^}]*--project-dialog-notice: var\(--gray-3\)/);
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
  expect(mapping.runtimeVersion).toBe(UI_RUNTIME_VERSION);
  for (const component of mapping.components) {
    if (component.export === "Card") {
      expect(component.resourceVariant.minimumMinor).toBe(8);
      expect(component.relatedExports).toEqual(expect.arrayContaining(["CardIcon", "CardMeta"]));
    }
    expect(Object.hasOwn(core, component.export)).toBe(true);
    for (const name of component.relatedExports ?? []) expect(Object.hasOwn(core, name)).toBe(true);
    expect(Object.hasOwn(pkg.exports, component.package.replace("@ipollowork/ui", "."))).toBe(true);
    expect(readFileSync(new URL("../../../" + component.source, import.meta.url), "utf8")).not.toContain('from "@/');
  }
});

test("catalog separates maturity dimensions and keeps its module count and matrix executable", () => {
  const read = (path: string) => readFileSync(new URL("../../../" + path, import.meta.url), "utf8");
  const mapping = JSON.parse(read(".codex/skills/ipollowork-plugin-ui/references/component-mapping.json"));
  expect(mapping.statusDimensions).toEqual(["code", "adoption", "design", "interaction", "release"]);
  const count = [...read("packages/ui/src/react/core.ts").matchAll(/export \* from/g)].length;
  expect(read("packages/ui/README.md")).toContain(`exports ${count} modules`);
  expect(read(".codex/skills/ipollowork-plugin-ui/references/component-catalog.md")).toContain(`汇总${count}个模块`);
  for (const flow of ["shared-ui-core", "shared-ui-compositions", "shared-ui-compact-controls",
    "component-validation-matrix", "shared-ui-overlays", "shared-ui-async-feedback", "shared-ui-table",
    "video-workbench-modules", "video-script-inspector-readonly"]) {
    expect(read("packages/ui/README.md")).toContain(flow);
    expect(read(`evals/flows/${flow}.flow.mjs`)).toContain(flow);
  }
  expect(read("packages/ui/README.md")).toContain("Unmeasured cells remain Incomplete");
});


test("every curated public icon renders nonempty Lucide SVG with correct fixed pixel sizes and semantics", () => {
  expect(core.ICON_NAMES.length).toBe(32);
  expect(new Set(core.ICON_NAMES).size).toBe(32);
  for (const name of core.ICON_NAMES) {
    for (const [size, pixels] of [["s", 14], ["m", 16], ["l", 20]] satisfies [NonNullable<ComponentProps<typeof core.Icon>["size"]>, number][]) {
      const html = renderToStaticMarkup(createElement(core.Icon, { name, size }));
      expect(html).toContain('<svg');
      expect(html).toMatch(/<(path|circle|line|rect|polyline|polygon|ellipse) /);
      expect(html).toContain(`width:${pixels}px;height:${pixels}px`);
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toContain('role="img"');
    }
  }
  const labelled = renderToStaticMarkup(createElement(core.Icon, { name: "CircleCheck", label: "保存成功" }));
  expect(labelled).toContain('role="img"');
  expect(labelled).toContain('aria-label="保存成功"');
  expect(labelled).not.toContain('aria-hidden');
});

test("icons compose with the existing Button without duplicating its accessible name", () => {
  const html = renderToStaticMarkup(createElement(core.Button, { size: "icon", "aria-label": "搜索",
    children: createElement(core.Icon, { name: "Search" }),
  }));
  expect(html).toContain('aria-label="搜索"');
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('size-[32px]');
  for (const [size, height] of [["sm", 28], ["default", 32], ["lg", 36]] satisfies [NonNullable<ComponentProps<typeof core.Button>["size"]>, number][]) {
    expect(core.buttonVariants({ size })).toContain(`h-[${height}px]`);
  }
  for (const position of ["inline-start", "inline-end"] satisfies NonNullable<ComponentProps<typeof core.Icon>["data-icon"]>[]) {
    const content = renderToStaticMarkup(createElement(core.Button, { children: [createElement(core.Icon, { key: "icon", name: "Download", "data-icon": position }), "下载"] }));
    expect(content).toContain(`data-icon="${position}"`);
    expect(content).toContain('data-slot="button"');
  }
});
