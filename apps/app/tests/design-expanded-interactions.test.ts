import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toast as sonnerToast } from "sonner";
import { toast } from "../src/components/ui/sonner";
import { Button, ButtonStyleScopeProvider, buttonVariants } from "../src/components/ui/button";
import { TextInput } from "../src/react-app/design-system/text-input";
import { toggleVariants } from "../src/components/ui/toggle";
import { Badge } from "../src/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "../src/components/ui/table";
import { Alert, AlertTitle, AlertDescription } from "../src/components/ui/alert";
import { Progress } from "../src/components/ui/progress";

const designPanel = readFileSync(new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url), "utf8");
const exportMenu = readFileSync(new URL("../src/react-app/domains/session/design/design-export-menu.tsx", import.meta.url), "utf8");
const saveMenu = readFileSync(new URL("../src/react-app/domains/session/design/design-save-menu.tsx", import.meta.url), "utf8");
const panelSelect = readFileSync(new URL("../src/react-app/domains/session/design/design-panel-select.tsx", import.meta.url), "utf8");
const gradientPicker = readFileSync(new URL("../src/react-app/domains/session/design/design-gradient-picker.tsx", import.meta.url), "utf8");
const sidePanel = readFileSync(new URL("../src/react-app/domains/session/panel/side-panel.tsx", import.meta.url), "utf8");
const dropdownMenu = readFileSync(new URL("../src/components/ui/dropdown-menu.tsx", import.meta.url), "utf8");
const contextMenu = readFileSync(new URL("../src/components/ui/context-menu.tsx", import.meta.url), "utf8");
const select = readFileSync(new URL("../src/components/ui/select.tsx", import.meta.url), "utf8");
const popover = readFileSync(new URL("../src/components/ui/popover.tsx", import.meta.url), "utf8");
const menuStyles = readFileSync(new URL("../src/components/ui/menu-styles.ts", import.meta.url), "utf8");
const switchControl = readFileSync(new URL("../src/components/ui/switch.tsx", import.meta.url), "utf8");

test("toast cards keep the library ID for close and action dismissal", () => {
  for (const options of [undefined, { id: "compact-toast-regression" }]) {
    const id = toast.success("统一完成", options);
    const entry = sonnerToast.getToasts().find((item) => item.id === id);
    expect(entry).toBeDefined();
    if (!entry || !("jsx" in entry) || !React.isValidElement<{ id: string | number }>(entry.jsx)) {
      throw new Error("Missing toast card");
    }
    expect(entry.jsx.props.id).toBe(id);
  }
});

test("expanded Design menus render above the z-60 panel", () => {
  expect(sidePanel).toContain('positionerClassName={expanded ? "z-[70]" : undefined}');
  expect(exportMenu).toContain('positionerClassName={expanded ? "z-[70]" : undefined}');
  expect(saveMenu).toContain('positionerClassName={expanded ? "z-[70]" : undefined}');
  expect(dropdownMenu).toContain("positionerClassName");
  expect(sidePanel).toContain("expanded={expanded}");
});

test("floating menus share an 8px translucent surface with two densities", () => {
  expect(menuStyles).not.toMatch(/= "dark /);
  expect(menuStyles).toContain("min-h-8");
  expect(menuStyles).toContain("min-h-7");
  expect(menuStyles).toContain("text-destructive!");
  expect(menuStyles).toContain('rounded-[8px]! bg-popover/90');
  expect(menuStyles).toContain("ring-foreground/10 backdrop-blur-2xl backdrop-saturate-150");
  expect(menuStyles).not.toContain("before:backdrop-blur");
  expect(menuStyles).toContain("shadow-lg ring-1");
  expect(menuStyles).toContain("default: {");
  expect(menuStyles).toContain("compact: {");
  for (const source of [dropdownMenu, contextMenu, select, popover]) {
    expect(source).toContain("menuSurfaceClassName");
  }
  expect(panelSelect).toContain('from "@/components/ui/select"');
  expect(panelSelect).toContain("<SelectContent");
  expect(panelSelect).not.toContain("createPortal");
  expect(gradientPicker).not.toContain("rounded-2xl border border-[#dedede] bg-white");
  expect(`${dropdownMenu}\n${contextMenu}\n${select}\n${popover}`).not.toMatch(/rounded-(?:2xl|3xl)/);
});

test("compact controls preserve size choices, semantics and settings density", () => {
  expect(buttonVariants()).toContain("h-8");
  expect(buttonVariants({ size: "sm" })).toContain("h-7");
  expect(buttonVariants({ size: "lg" })).toContain("h-9");
  const button = renderToStaticMarkup(React.createElement(ButtonStyleScopeProvider, {
    value: "settings", children: React.createElement(Button, {
      variant: "ghost", disabled: true, "aria-label": "编辑", children: "编辑",
    }),
  }));
  expect(button).toContain("h-7");
  expect(button).toContain("disabled");
  expect(button).toContain('aria-label="编辑"');
  const input = renderToStaticMarkup(React.createElement(TextInput, {
    label: "名称", hint: "请输入名称", disabled: true, "aria-invalid": true,
  }));
  expect(input).toContain('data-slot="input"');
  expect(input).toContain("h-8");
  expect(input).toContain('aria-invalid="true"');
  expect(input).toContain("请输入名称");
});

test("migrated main-client action groups use the shared Button", () => {
  const paths = [
    "../src/react-app/domains/settings/settings-segmented-tabs.tsx",
    "../src/react-app/domains/settings/pages/ai-view.tsx",
    "../src/react-app/domains/settings/pages/debug-view.tsx",
    "../src/react-app/domains/help/help-route.tsx",
    "../src/react-app/domains/session/video/video-voice-panel.tsx",
  ];
  for (const path of paths) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source).toContain('import { Button } from "@/components/ui/button"');
    expect(source).not.toMatch(/<button\b/);
  }
});

test("switches share the teal enabled state", () => {
  expect(switchControl).toContain("data-checked:border-[#1FBAC0] data-checked:bg-[#1FBAC0]");
  expect(designPanel).not.toContain("#0A84FF");
});

test("remaining compact families preserve content and semantic elements", () => {
  expect(toggleVariants()).toContain("h-8");
  expect(toggleVariants({ size: "sm" })).toContain("h-7");
  expect(toggleVariants({ size: "lg" })).toContain("h-9");
  const badge = renderToStaticMarkup(React.createElement(Badge, { variant: "secondary", children: "等待确认" }));
  expect(badge).toContain("min-h-5");
  expect(badge).not.toContain("overflow-hidden");
  expect(badge).toContain("等待确认");
  const table = renderToStaticMarkup(React.createElement(Table, {},
    React.createElement(TableHeader, {}, React.createElement(TableRow, {}, React.createElement(TableHead, {}, "名称"))),
    React.createElement(TableBody, {}, React.createElement(TableRow, {}, React.createElement(TableCell, {}, "组件规范"))),
  ));
  expect(table).toContain("<th");
  expect(table).toContain("h-8 px-2.5");
  expect(table).toContain("px-2.5 py-2");
  expect(table).toContain("overflow-x-auto");
  const alert = renderToStaticMarkup(React.createElement(Alert, {},
    React.createElement(AlertTitle, {}, "需要补充信息"),
    React.createElement(AlertDescription, {}, "请检查配置后重试。"),
  ));
  expect(alert).toContain('role="alert"');
  expect(alert).toContain("px-3 py-3");
  expect(alert).toContain("border-sky-11");
  expect(alert).toContain("请检查配置后重试。");
});

test("task progress shares a compact track without inventing a value", () => {
  const measured = renderToStaticMarkup(React.createElement(Progress, { value: 45, "aria-label": "下载进度" }));
  const pending = renderToStaticMarkup(React.createElement(Progress, { value: null, "aria-label": "正在连接" }));
  expect(measured).toContain('aria-valuenow="45"');
  expect(measured).toContain("h-1.5");
  expect(measured).toContain("bg-[#1FBAC0]");
  expect(pending).toContain("data-indeterminate");
  expect(pending).not.toContain("aria-valuenow");
});

test("the parent presentation viewport handles Ctrl or Meta wheel zoom", () => {
  expect(designPanel).toContain("!event.ctrlKey && !event.metaKey");
  expect(designPanel).toContain("presentationCanvasWheelZoom(current, event.deltaY)");
  expect(designPanel).toContain('addEventListener("wheel"');
  expect(designPanel).toContain("passive: false");
});
