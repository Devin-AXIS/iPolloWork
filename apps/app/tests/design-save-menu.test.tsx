import { afterEach, describe, expect, mock, test } from "bun:test";
import * as React from "react";

import { setLocale } from "../src/i18n";
import { DesignSaveMenu } from "../src/react-app/domains/session/design/design-save-menu";

function childrenOf(node: React.ReactNode): React.ReactNode[] {
  if (!React.isValidElement(node)) return [];
  return [
    ...React.Children.toArray(Reflect.get(node.props, "children")),
    ...React.Children.toArray(Reflect.get(node.props, "render")),
  ];
}

function textContent(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return childrenOf(node).map(textContent).join(" ");
}

function findByText(node: React.ReactNode, label: string): React.ReactElement {
  for (const child of childrenOf(node)) {
    try {
      return findByText(child, label);
    } catch {
      // Keep searching sibling branches.
    }
  }
  if (React.isValidElement(node) && textContent(node).trim() === label) return node;
  throw new Error(`Could not find element with text: ${label}`);
}

afterEach(() => setLocale("en"));

describe("design save menu", () => {
  test("offers save design and save to my templates from one save icon", () => {
    setLocale("zh");
    const onSave = mock(() => undefined);
    const onSaveAsTemplate = mock(() => undefined);
    const result = DesignSaveMenu({
      saving: false,
      saveDisabled: false,
      onSave,
      onSaveAsTemplate,
    });

    Reflect.get(findByText(result, "保存设计").props, "onClick")();
    Reflect.get(findByText(result, "保存到我的模板").props, "onClick")();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSaveAsTemplate).toHaveBeenCalledTimes(1);
  });
});
