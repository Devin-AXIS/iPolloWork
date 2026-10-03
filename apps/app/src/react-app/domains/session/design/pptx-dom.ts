export function isPptxExportElement(node: Node | null | undefined): node is HTMLElement {
  return node?.nodeType === 1 && typeof (node as Element).matches === "function";
}

export function isPptxExportImage(node: Node | null | undefined): node is HTMLImageElement {
  return isPptxExportElement(node) && node.tagName === "IMG";
}

export function isPptxExportSvg(node: Node | null | undefined): node is SVGSVGElement {
  return isPptxExportElement(node) && node.localName === "svg";
}

export function pptxCssPixels(value: string) {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : 0;
}

export function pptxEffectiveOpacity(element: HTMLElement, slide: HTMLElement) {
  let opacity = 1;
  for (let current: HTMLElement | null = element; current && current !== slide; current = current.parentElement) {
    const value = Number.parseFloat(current.ownerDocument.defaultView?.getComputedStyle(current).opacity ?? "1");
    opacity *= Number.isFinite(value) ? value : 1;
  }
  return opacity;
}
