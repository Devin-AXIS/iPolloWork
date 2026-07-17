import {
  PPTX_SLIDE_HEIGHT_INCHES,
  PPTX_SLIDE_WIDTH_INCHES,
} from "./pptx-export";
import { isPptxExportImage } from "./pptx-dom";

export type PptxCompatibleTextRun = {
  text: string;
  breakLineBefore?: boolean;
  style: {
    color: string;
    bold: boolean;
    italic?: boolean;
    fontFace?: string;
    fontSize?: number;
  };
};

export type PptxCompatibleTextOutputRun = {
  text: string;
  options: PptxCompatibleTextRun["style"] & { softBreakBefore?: boolean };
};

export type PptxCompatibleValidation =
  | { valid: true }
  | { valid: false; reason: "unsupported-visual" | "unmarked-visible-element" };

export type PptxCompatibleFrame = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PptxCompatibleShape = {
  type: "rect" | "roundRect" | "line" | "ellipse";
  frame: PptxCompatibleFrame;
  fill: { color: string; transparency: number };
  line: { color: string; transparency: number; width: number };
};

export type PptxCompatibleText = {
  frame: PptxCompatibleFrame;
  runs: PptxCompatibleTextOutputRun[];
  fontFace: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right" | "justify";
  lineSpacing?: number;
  charSpacing?: number;
};

export type PptxCompatibleImage = {
  frame: PptxCompatibleFrame;
  data: string;
  altText: string;
};

export type PptxCompatibleObject =
  | { kind: "shape"; value: PptxCompatibleShape }
  | { kind: "text"; value: PptxCompatibleText }
  | { kind: "image"; value: PptxCompatibleImage };

const ignoredSelector = "[data-pptx-ignore]";
const markedSelector = "[data-pptx-shape],[data-pptx-text],[data-pptx-image],[data-pptx-ignore]";
const nativeObjectMarkerPattern = /\bdata-pptx-(?:shape|text|image)\b/i;
const runtimeClassNames = new Set([
  "slide-counter",
  "controls",
  "deck-chrome",
  "deck-controls",
  "dots",
  "counter",
]);
const runtimeArtifactSelector = "script,[data-pptx-ignore],[data-ipw-notes],.ipw-notes,.slide-counter,.controls,.deck-chrome,.deck-controls,.dots,.counter,[data-ipw-deck-control],[data-ipw-prev],[data-ipw-next],[data-action='prev'],[data-action='previous'],[data-action='next']";
const markerNames = new Set(["data-pptx-shape", "data-pptx-text", "data-pptx-image", "data-pptx-ignore"]);
const unsupportedProperties = [
  "backgroundImage",
  "filter",
  "backdropFilter",
  "mixBlendMode",
  "clipPath",
  "maskImage",
  "textShadow",
] as const;

function round(value: number) {
  return Number(value.toFixed(3));
}

function px(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function points(value: string) {
  return round(px(value) * 0.75);
}

export function pointsForPptxCompatibleSlide(value: string, slideWidthPixels: number) {
  if (!Number.isFinite(slideWidthPixels) || slideWidthPixels <= 0) return points(value);
  return round(px(value) / slideWidthPixels * PPTX_SLIDE_WIDTH_INCHES * 72);
}

function parseColor(value: string) {
  if (!value || value === "transparent") return { color: "000000", transparency: 100 };
  const hex = value.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3 || hex.length === 4
      ? hex.split("").map((part) => `${part}${part}`).join("")
      : hex;
    const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6), 16) / 255 : 1;
    return { color: expanded.slice(0, 6).toUpperCase(), transparency: Math.round((1 - alpha) * 100) };
  }
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (!rgb) return { color: "000000", transparency: 100 };
  const alpha = rgb[4] == null ? 1 : Math.max(0, Math.min(1, Number(rgb[4])));
  return {
    color: rgb.slice(1, 4).map((channel) => Number(channel).toString(16).padStart(2, "0")).join("").toUpperCase(),
    transparency: Math.round((1 - alpha) * 100),
  };
}

function transparency(colorTransparency: number, opacity: number) {
  const alpha = (1 - colorTransparency / 100) * Math.max(0, Math.min(1, opacity));
  return Math.round((1 - alpha) * 100);
}

function fontFace(value: string) {
  return value.split(",").map((part) => part.trim().replace(/["']/g, "")).find(Boolean) || "Arial";
}

function frameFor(slideBox: DOMRect, box: DOMRect): PptxCompatibleFrame {
  return {
    x: round((box.left - slideBox.left) / slideBox.width * PPTX_SLIDE_WIDTH_INCHES),
    y: round((box.top - slideBox.top) / slideBox.height * PPTX_SLIDE_HEIGHT_INCHES),
    w: round(box.width / slideBox.width * PPTX_SLIDE_WIDTH_INCHES),
    h: round(box.height / slideBox.height * PPTX_SLIDE_HEIGHT_INCHES),
  };
}

export function frameForPptxCompatibleShape(type: PptxCompatibleShape["type"], frame: PptxCompatibleFrame): PptxCompatibleFrame {
  return type === "line" ? { ...frame, h: 0 } : frame;
}

export function hasUnsupportedPptxCompatibleTransition(duration: string) {
  return duration.split(",").some((part) => {
    const value = Number.parseFloat(part.trim());
    return Number.isFinite(value) && value !== 0;
  });
}

function visible(box: DOMRect, slideBox: DOMRect, style: CSSStyleDeclaration, type?: PptxCompatibleShape["type"]) {
  return style.display !== "none"
    && style.visibility !== "hidden"
    && Number(style.opacity) > 0
    && hasPptxCompatibleVisibleDimensions(type, box.width, box.height)
    && box.left >= slideBox.left
    && box.top >= slideBox.top
    && box.right <= slideBox.right
    && box.bottom <= slideBox.bottom;
}

export function hasPptxCompatibleVisibleDimensions(type: PptxCompatibleShape["type"] | undefined, width: number, height: number) {
  return width > 1 && (height > 1 || type === "line" && height > 0);
}

function unsupported(style: CSSStyleDeclaration) {
  return style.transform !== "none"
    || style.animationName !== "none"
    || hasUnsupportedPptxCompatibleTransition(style.transitionDuration)
    || unsupportedProperties.some((property) => {
      const value = style[property];
      return property === "mixBlendMode" ? value !== "normal" : value !== "none";
    });
}

function effectiveOpacity(element: HTMLElement, slide: HTMLElement) {
  let opacity = 1;
  for (let current: HTMLElement | null = element; current && current !== slide; current = current.parentElement) {
    const value = Number.parseFloat(current.ownerDocument.defaultView?.getComputedStyle(current).opacity ?? "1");
    opacity *= Number.isFinite(value) ? value : 1;
  }
  return opacity;
}

function elementTextRuns(element: HTMLElement, slideWidthPixels: number): PptxCompatibleTextRun[] {
  const view = element.ownerDocument.defaultView;
  if (!view) return [];
  const runs: PptxCompatibleTextRun[] = [];
  let breakLineBefore = false;
  const visit = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") {
      breakLineBefore = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.replace(/\s+/g, " ") ?? "";
      if (!text.trim()) return;
      const owner = node.parentElement;
      const style = owner ? view.getComputedStyle(owner) : view.getComputedStyle(element);
      const color = parseColor(style.color);
      runs.push({
        text,
        ...(breakLineBefore ? { breakLineBefore: true } : {}),
        style: {
          color: color.color,
          bold: Number.parseInt(style.fontWeight, 10) >= 600 || style.fontWeight === "bold",
          italic: style.fontStyle === "italic",
          fontFace: fontFace(style.fontFamily),
          fontSize: pointsForPptxCompatibleSlide(style.fontSize, slideWidthPixels),
        },
      });
      breakLineBefore = false;
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  visit(element);
  return runs;
}

function shapeFor(element: HTMLElement, slide: HTMLElement, slideBox: DOMRect, style: CSSStyleDeclaration): PptxCompatibleShape {
  const fill = parseColor(style.backgroundColor);
  const line = parseColor(style.borderTopColor);
  const opacity = effectiveOpacity(element, slide);
  const kind = element.dataset.pptxShape;
  if (kind !== "rect" && kind !== "roundRect" && kind !== "line" && kind !== "ellipse") {
    throw new Error("Unsupported PPTX shape marker.");
  }
  return {
    type: kind,
    frame: frameForPptxCompatibleShape(kind, frameFor(slideBox, element.getBoundingClientRect())),
    fill: { color: fill.color, transparency: transparency(fill.transparency, opacity) },
    line: {
      color: line.color,
      transparency: transparency(line.transparency, opacity),
      width: pointsForPptxCompatibleSlide(style.borderTopWidth, slideBox.width),
    },
  };
}

function textFor(element: HTMLElement, slide: HTMLElement, slideBox: DOMRect, style: CSSStyleDeclaration): PptxCompatibleText {
  const color = parseColor(style.color);
  const runs = createPptxCompatibleTextRuns(elementTextRuns(element, slideBox.width));
  const lineHeight = Number.parseFloat(style.lineHeight);
  const letterSpacing = Number.parseFloat(style.letterSpacing);
  const alignment = style.textAlign === "center" || style.textAlign === "right" || style.textAlign === "justify"
    ? style.textAlign
    : "left";
  return {
    frame: frameFor(slideBox, element.getBoundingClientRect()),
    runs,
    fontFace: fontFace(style.fontFamily),
    fontSize: pointsForPptxCompatibleSlide(style.fontSize, slideBox.width),
    color: color.color,
    bold: Number.parseInt(style.fontWeight, 10) >= 600 || style.fontWeight === "bold",
    italic: style.fontStyle === "italic",
    align: alignment,
    ...(Number.isFinite(lineHeight) ? { lineSpacing: pointsForPptxCompatibleSlide(style.lineHeight, slideBox.width) } : {}),
    ...(Number.isFinite(letterSpacing) ? { charSpacing: pointsForPptxCompatibleSlide(style.letterSpacing, slideBox.width) } : {}),
  };
}

function imageFor(element: HTMLImageElement, slideBox: DOMRect): PptxCompatibleImage {
  const src = element.currentSrc || element.src;
  if (!src.startsWith("data:image/")) throw new Error("PPTX-compatible templates require embedded image data URLs.");
  return {
    frame: frameFor(slideBox, element.getBoundingClientRect()),
    data: src,
    altText: element.alt,
  };
}

export function createPptxCompatibleTextRuns(runs: readonly PptxCompatibleTextRun[]): PptxCompatibleTextOutputRun[] {
  return runs
    .filter((run) => run.text.trim().length > 0)
    .map((run) => ({
      text: run.text.replace(/^\s+/, ""),
      options: {
        ...run.style,
        ...(run.breakLineBefore ? { softBreakBefore: true } : {}),
      },
    }));
}

export function hasPptxCompatibleObjectMarkers(html: string) {
  return nativeObjectMarkerPattern.test(html);
}

export function normalizePptxCompatibleMarkerName(name: string) {
  const normalized = name.replace(/["']+$/g, "");
  return markerNames.has(normalized) ? normalized : null;
}

export function normalizePptxCompatibleMarkers(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const markerName = normalizePptxCompatibleMarkerName(attribute.name);
      if (!markerName || element.hasAttribute(markerName)) continue;
      element.setAttribute(markerName, attribute.value);
      element.removeAttribute(attribute.name);
    }
  });
}

export type PptxCompatibleRuntimeElement = {
  tagName: string;
  className: string;
  attributes: Record<string, string | undefined>;
};

export function isPptxCompatibleRuntimeElement(element: PptxCompatibleRuntimeElement) {
  if ("data-pptx-ignore" in element.attributes || "data-ipw-notes" in element.attributes) return true;
  if ("data-ipw-deck-control" in element.attributes || "data-ipw-prev" in element.attributes || "data-ipw-next" in element.attributes) return true;
  if (element.attributes["data-action"] === "prev" || element.attributes["data-action"] === "previous" || element.attributes["data-action"] === "next") return true;
  return element.className.split(/\s+/).some((className) => runtimeClassNames.has(className));
}

export function removePptxCompatibleRuntimeArtifacts(root: ParentNode) {
  root.querySelectorAll(runtimeArtifactSelector).forEach((element) => element.remove());
}

function runtimeElementFor(element: HTMLElement): PptxCompatibleRuntimeElement {
  return {
    tagName: element.tagName,
    className: typeof element.className === "string" ? element.className : "",
    attributes: Object.fromEntries(Array.from(element.attributes, (attribute) => [attribute.name, attribute.value])),
  };
}

export function validatePptxCompatibleMarkup(input: {
  hasUnsupportedVisual: boolean;
  hasUnmarkedVisibleElement: boolean;
}): PptxCompatibleValidation {
  if (input.hasUnsupportedVisual) return { valid: false, reason: "unsupported-visual" };
  if (input.hasUnmarkedVisibleElement) return { valid: false, reason: "unmarked-visible-element" };
  return { valid: true };
}

export function collectPptxCompatibleObjects(slide: HTMLElement): PptxCompatibleObject[] {
  normalizePptxCompatibleMarkers(slide);
  const view = slide.ownerDocument.defaultView;
  const slideBox = slide.getBoundingClientRect();
  if (!view || !slideBox.width || !slideBox.height) throw new Error("Could not read PPTX-compatible slide geometry.");

  const objects: PptxCompatibleObject[] = [];
  const elements = Array.from(slide.querySelectorAll<HTMLElement>(markedSelector));
  const unmarkedVisibleElement = Array.from(slide.querySelectorAll<HTMLElement>("*")).some((element) => {
    if (element.closest(runtimeArtifactSelector)) return false;
    if (isPptxCompatibleRuntimeElement(runtimeElementFor(element))) return false;
    if (element.closest(ignoredSelector) || element.matches(markedSelector) || element.closest("[data-pptx-shape],[data-pptx-text],[data-pptx-image]")) return false;
    const style = view.getComputedStyle(element);
    return visible(element.getBoundingClientRect(), slideBox, style) && (element.children.length === 0 || isPptxExportImage(element));
  });
  const unsupportedVisual = elements.some((element) => unsupported(view.getComputedStyle(element)));
  const validation = validatePptxCompatibleMarkup({ hasUnsupportedVisual: unsupportedVisual, hasUnmarkedVisibleElement: unmarkedVisibleElement });
  if (!validation.valid) throw new Error(`PPTX-compatible export blocked: ${validation.reason}.`);

  for (const element of elements) {
    if (element.closest(ignoredSelector)) continue;
    const style = view.getComputedStyle(element);
    const box = element.getBoundingClientRect();
    if (!visible(box, slideBox, style, element.dataset.pptxShape as PptxCompatibleShape["type"] | undefined)) continue;
    if (element.hasAttribute("data-pptx-shape")) objects.push({ kind: "shape", value: shapeFor(element, slide, slideBox, style) });
    else if (element.hasAttribute("data-pptx-text")) objects.push({ kind: "text", value: textFor(element, slide, slideBox, style) });
    else if (element.hasAttribute("data-pptx-image")) {
      if (!isPptxExportImage(element)) throw new Error("PPTX image marker must be on an image element.");
      objects.push({ kind: "image", value: imageFor(element, slideBox) });
    }
  }
  return objects;
}

export function pptxCompatibleSlideBackground(slide: HTMLElement) {
  const style = slide.ownerDocument.defaultView?.getComputedStyle(slide);
  if (!style) throw new Error("Could not read PPTX-compatible slide background.");
  if (unsupported(style)) throw new Error("PPTX-compatible export blocked: unsupported slide visual.");
  const color = parseColor(style.backgroundColor);
  if (color.transparency === 100) throw new Error("PPTX-compatible slides require a solid background color.");
  return color.color;
}
