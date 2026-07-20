export function isPptxExportElement(node: Node | null | undefined): node is HTMLElement {
  return node?.nodeType === 1 && typeof (node as Element).matches === "function";
}

export function isPptxExportImage(node: Node | null | undefined): node is HTMLImageElement {
  return isPptxExportElement(node) && node.tagName === "IMG";
}
