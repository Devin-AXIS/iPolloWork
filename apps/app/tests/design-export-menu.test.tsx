import { readFileSync } from "node:fs";
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

function findByAriaLabel(node: React.ReactNode, label: string): React.ReactElement {
  if (React.isValidElement(node) && Reflect.get(node.props, "aria-label") === label) return node;
  for (const child of childrenOf(node)) {
    try {
      return findByAriaLabel(child, label);
    } catch {
      // Keep searching sibling branches.
    }
  }
  throw new Error(`Could not find element with aria-label: ${label}`);
}

function menu(overrides: Partial<React.ComponentProps<typeof DesignExportMenu>> = {}) {
  return DesignExportMenu({
    exportingHtml: false,
    exportingPdf: false,
    exportingPptx: false,
    isPresentation: true,
    onExportHtml: () => undefined,
    onExportPdf: () => undefined,
    onExportPptx: () => undefined,
    ...overrides,
  });
}

afterEach(() => setLocale("en"));

describe("design export download menu", () => {
  test("uses a language-independent icon trigger and localized format labels", () => {
    setLocale("en");
    const englishMenu = menu();
    const englishTrigger = findByAriaLabel(englishMenu, "Download");
    expect(textContent(englishTrigger).trim()).toBe("");
    expect(textContent(englishMenu)).toContain("Download HTML");
    expect(textContent(englishMenu)).toContain("Download PDF");
    expect(textContent(englishMenu)).toContain("Download PPTX");

    setLocale("zh");
    const chineseMenu = menu();
    const chineseTrigger = findByAriaLabel(chineseMenu, "下载");
    expect(textContent(chineseTrigger).trim()).toBe("");
    expect(textContent(chineseMenu)).toContain("下载 HTML");
    expect(textContent(chineseMenu)).toContain("下载 PDF");
    expect(textContent(chineseMenu)).toContain("下载 PPTX");
  });

  test("replaces the two toolbar export buttons with the shared menu", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain("<DesignExportMenu");
    expect(panelSource).toContain("onExportHtml={() => void exportDesignToHtml()}");
    expect(panelSource).toContain("onExportPdf={() => void exportDeckToPdf()}");
    expect(panelSource).toContain("onExportPptx={() => setPptxConfirmationOpen(true)}");
    expect(panelSource).not.toContain("Export presentation to PDF");
    expect(panelSource).not.toContain("Export presentation to PPTX");
  });

  test("routes each format to its export action", () => {
    const onExportHtml = mock(() => undefined);
    const onExportPdf = mock(() => undefined);
    const onExportPptx = mock(() => undefined);
    const result = menu({ onExportHtml, onExportPdf, onExportPptx });

    Reflect.get(findByText(result, "Download HTML").props, "onClick")();
    expect(onExportHtml).toHaveBeenCalledTimes(1);
    expect(onExportPdf).not.toHaveBeenCalled();
    expect(onExportPptx).not.toHaveBeenCalled();

    Reflect.get(findByText(result, "Download PDF").props, "onClick")();
    expect(onExportPdf).toHaveBeenCalledTimes(1);
    expect(onExportPptx).not.toHaveBeenCalled();

    Reflect.get(findByText(result, "Download PPTX").props, "onClick")();
    expect(onExportPptx).toHaveBeenCalledTimes(1);
  });

  test("disables only the format currently being generated", () => {
    const htmlBusy = menu({ exportingHtml: true });
    expect(Reflect.get(findByText(htmlBusy, "Download HTML").props, "disabled")).toBe(true);
    expect(Reflect.get(findByText(htmlBusy, "Download PDF").props, "disabled")).toBe(false);

    const pdfBusy = menu({ exportingPdf: true });
    expect(Reflect.get(findByText(pdfBusy, "Download PDF").props, "disabled")).toBe(true);
    expect(Reflect.get(findByText(pdfBusy, "Download PPTX").props, "disabled")).toBe(false);

    const pptxBusy = menu({ exportingPptx: true });
    expect(Reflect.get(findByText(pptxBusy, "Download PDF").props, "disabled")).toBe(false);
    expect(Reflect.get(findByText(pptxBusy, "Download PPTX").props, "disabled")).toBe(true);
  });

  test("disables the download trigger while any format is being generated", () => {
    expect(Reflect.get(findByAriaLabel(menu({ exportingHtml: true }), "Download").props, "disabled")).toBe(true);
    expect(Reflect.get(findByAriaLabel(menu({ exportingPdf: true }), "Download").props, "disabled")).toBe(true);
    expect(Reflect.get(findByAriaLabel(menu({ exportingPptx: true }), "Download").props, "disabled")).toBe(true);
  });

  test("offers HTML to every Design document and presentation formats only to decks", () => {
    const pageMenu = menu({ isPresentation: false });
    expect(textContent(pageMenu)).toContain("Download HTML");
    expect(textContent(pageMenu)).not.toContain("Download PDF");
    expect(textContent(pageMenu)).not.toContain("Download PPTX");

    const deckMenu = menu({ isPresentation: true });
    expect(textContent(deckMenu)).toContain("Download HTML");
    expect(textContent(deckMenu)).toContain("Download PDF");
    expect(textContent(deckMenu)).toContain("Download PPTX");
  });

  test("downloads the latest clean canvas snapshot instead of the preview source", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain("const content = editing ? await readLatestCanvasHtml() : draftRef.current");
    expect(panelSource).toContain('new Blob([content], { type: "text/html;charset=utf-8" })');
    expect(panelSource).toContain("link.download = htmlDownloadFileName(activePagePath)");
  });
});
