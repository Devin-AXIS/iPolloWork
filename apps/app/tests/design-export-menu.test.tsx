import { afterEach, describe, expect, mock, test } from "bun:test";
import * as React from "react";

import { setLocale } from "../src/i18n";
import { DesignExportMenu } from "../src/react-app/domains/session/design/design-export-menu";

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

function menu(overrides: Partial<React.ComponentProps<typeof DesignExportMenu>> = {}) {
  return DesignExportMenu({
    exportingPdf: false,
    exportingPptx: false,
    onExportPdf: () => undefined,
    onExportPptx: () => undefined,
    ...overrides,
  });
}

afterEach(() => setLocale("en"));

describe("design export download menu", () => {
  test("uses localized labels for the trigger and both formats", () => {
    setLocale("en");
    expect(textContent(menu())).toContain("Download");
    expect(textContent(menu())).toContain("Download PDF");
    expect(textContent(menu())).toContain("Download PPTX");

    setLocale("zh");
    expect(textContent(menu())).toContain("下载");
    expect(textContent(menu())).toContain("下载 PDF");
    expect(textContent(menu())).toContain("下载 PPTX");
  });

  test("routes each format to its existing export action", () => {
    const onExportPdf = mock(() => undefined);
    const onExportPptx = mock(() => undefined);
    const result = menu({ onExportPdf, onExportPptx });

    Reflect.get(findByText(result, "Download PDF").props, "onClick")();
    expect(onExportPdf).toHaveBeenCalledTimes(1);
    expect(onExportPptx).not.toHaveBeenCalled();

    Reflect.get(findByText(result, "Download PPTX").props, "onClick")();
    expect(onExportPptx).toHaveBeenCalledTimes(1);
  });

  test("disables only the format currently being generated", () => {
    const pdfBusy = menu({ exportingPdf: true });
    expect(Reflect.get(findByText(pdfBusy, "Download PDF").props, "disabled")).toBe(true);
    expect(Reflect.get(findByText(pdfBusy, "Download PPTX").props, "disabled")).toBe(false);

    const pptxBusy = menu({ exportingPptx: true });
    expect(Reflect.get(findByText(pptxBusy, "Download PDF").props, "disabled")).toBe(false);
    expect(Reflect.get(findByText(pptxBusy, "Download PPTX").props, "disabled")).toBe(true);
  });

  test("disables the download trigger only when both formats are busy", () => {
    expect(Reflect.get(findByText(menu({ exportingPdf: true }), "Download").props, "disabled")).toBe(false);
    expect(Reflect.get(findByText(menu({ exportingPptx: true }), "Download").props, "disabled")).toBe(false);
    expect(Reflect.get(findByText(menu({ exportingPdf: true, exportingPptx: true }), "Download").props, "disabled")).toBe(true);
  });
});
