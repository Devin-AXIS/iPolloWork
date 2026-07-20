import {
  createPptxShapeOverlay,
  createPptxTextOverlay,
  createPptxVisualShadow,
  PPTX_SLIDE_HEIGHT_INCHES,
  PPTX_SLIDE_WIDTH_INCHES,
  type PptxShapeOverlay,
  type PptxTextOverlay,
} from "./pptx-export";
import { isPptxExportElement } from "./pptx-dom";

export type PptxElementKind = "shape" | "text" | "image" | "fallback";

export type PptxFrame = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PptxElementPlan = {
  kind: PptxElementKind;
  element: HTMLElement;
  frame: PptxFrame;
  text?: PptxTextOverlay;
  shape?: PptxShapeOverlay;
};

export type PptxBackgroundPlan =
  | { kind: "color"; color: string }
  | { kind: "fallback"; element: HTMLElement; frame: PptxFrame }
  | null;

type PptxElementStyle = {
  backgroundImage: string;
  transform: string;
  filter: string;
  textShadow?: string;
  backgroundClip?: string;
  webkitBackgroundClip?: string;
  backdropFilter?: string;
  mixBlendMode?: string;
  clipPath?: string;
  maskImage?: string;
};

type PptxElementClassificationInput = {
  tag: string;
  text?: string;
  src?: string;
  style: PptxElementStyle;
};

const textTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li"]);
const shapeTags = new Set(["div", "article", "aside", "section", "header", "footer", "main"]);
const skippedSelector = ".notes,[data-ipw-deck-control],[data-action='prev'],[data-action='previous'],[data-action='next'],.deck-chrome,.deck-controls,.dots,.counter";

function round(value: number) {
  return Number(value.toFixed(3));
}

function cssPixels(value: string) {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : 0;
}

function parseColor(value: string) {
  if (!value || value === "transparent") return { color: "000000", transparency: 100 };
  const hexadecimal = value.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hexadecimal) {
    const expanded = hexadecimal.length === 3 || hexadecimal.length === 4
      ? hexadecimal.split("").map((part) => `${part}${part}`).join("")
      : hexadecimal;
    const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6), 16) / 255 : 1;
    return { color: expanded.slice(0, 6).toUpperCase(), transparency: Math.round((1 - alpha) * 100) };
  }
  const match = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (!match) return { color: "111827", transparency: 0 };
  const alpha = match[4] == null ? 1 : Math.max(0, Math.min(1, Number(match[4])));
  return {
    color: match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("").toUpperCase(),
    transparency: Math.round((1 - alpha) * 100),
  };
}

function effectiveOpacity(element: HTMLElement, slide: HTMLElement) {
  let opacity = 1;
  for (let current: HTMLElement | null = element; current && current !== slide; current = current.parentElement) {
    const value = Number.parseFloat(current.ownerDocument.defaultView?.getComputedStyle(current).opacity ?? "1");
    opacity *= Number.isFinite(value) ? value : 1;
  }
  return opacity;
}

function isUnsupportedVisualStyle(style: PptxElementStyle) {
  return style.backgroundImage !== "none"
    || style.transform !== "none"
    || style.filter !== "none"
    || (style.backdropFilter != null && style.backdropFilter !== "none")
    || (style.mixBlendMode != null && style.mixBlendMode !== "normal")
    || (style.clipPath != null && style.clipPath !== "none")
    || (style.maskImage != null && style.maskImage !== "none");
}

function isUnsupportedTextStyle(style: PptxElementStyle) {
  return isUnsupportedVisualStyle(style)
    || style.textShadow !== "none"
    || style.backgroundClip === "text"
    || style.webkitBackgroundClip === "text";
}

export function classifyPptxElement(input: PptxElementClassificationInput): PptxElementKind {
  const tag = input.tag.toLowerCase();
  if (tag === "img") return isUnsupportedVisualStyle(input.style) ? "fallback" : "image";
  if (tag === "svg" || tag === "canvas" || tag === "video") return "fallback";
  if (textTags.has(tag)) return input.text && !isUnsupportedTextStyle(input.style) ? "text" : "fallback";
  if (shapeTags.has(tag)) return isUnsupportedVisualStyle(input.style) ? "fallback" : "shape";
  return "fallback";
}

function hasVisiblePseudoElement(element: HTMLElement) {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  return ["::before", "::after"].some((pseudo) => {
    const style = view.getComputedStyle(element, pseudo);
    return style.content !== "none" && style.content !== "normal" && style.content !== '""';
  });
}

export function intersectsPptxSlide(
  box: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">,
  slideBox: Pick<DOMRect, "left" | "top" | "right" | "bottom">,
) {
  return box.right > slideBox.left
    && box.left < slideBox.right
    && box.bottom > slideBox.top
    && box.top < slideBox.bottom;
}

function isVisibleInsideSlide(box: DOMRect, slideBox: DOMRect) {
  return box.width > 1
    && box.height > 1
    && intersectsPptxSlide(box, slideBox);
}

function elementFrame(slideBox: DOMRect, box: DOMRect): PptxFrame {
  return {
    x: round((box.left - slideBox.left) / slideBox.width * PPTX_SLIDE_WIDTH_INCHES),
    y: round((box.top - slideBox.top) / slideBox.height * PPTX_SLIDE_HEIGHT_INCHES),
    w: round(box.width / slideBox.width * PPTX_SLIDE_WIDTH_INCHES),
    h: round(box.height / slideBox.height * PPTX_SLIDE_HEIGHT_INCHES),
  };
}

function hasSimpleShapePaint(style: CSSStyleDeclaration) {
  const fill = parseColor(style.backgroundColor).transparency < 100;
  const borderWidths = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map(cssPixels);
  const uniformBorder = borderWidths.every((width) => width > 0)
    && new Set([style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor]).size === 1
    && new Set(borderWidths).size === 1;
  return fill || uniformBorder || createPptxVisualShadow(style.boxShadow) != null;
}

function hasDirectText(element: HTMLElement) {
  return Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
}

export function requiresPptxInlineTextFallback(input: {
  tag: string;
  hasDirectText: boolean;
  hasElementChildren: boolean;
}) {
  return !textTags.has(input.tag.toLowerCase()) && input.hasDirectText && input.hasElementChildren;
}

function createTextPlan(element: HTMLElement, slide: HTMLElement, slideBox: DOMRect, box: DOMRect, style: CSSStyleDeclaration): PptxElementPlan {
  return {
    kind: "text",
    element,
    frame: elementFrame(slideBox, box),
    text: createPptxTextOverlay({
      text: element.innerText.trim(),
      slide: { left: slideBox.left, top: slideBox.top, width: slideBox.width, height: slideBox.height },
      box: { left: box.left, top: box.top, width: box.width, height: box.height },
      style: {
        color: style.color,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        textAlign: style.textAlign,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        opacity: effectiveOpacity(element, slide),
      },
    }),
  };
}

function createShapePlan(element: HTMLElement, slide: HTMLElement, slideBox: DOMRect, box: DOMRect, style: CSSStyleDeclaration): PptxElementPlan {
  return {
    kind: "shape",
    element,
    frame: elementFrame(slideBox, box),
    shape: createPptxShapeOverlay({
      slide: { left: slideBox.left, top: slideBox.top, width: slideBox.width, height: slideBox.height },
      box: { left: box.left, top: box.top, width: box.width, height: box.height },
      style: {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderTopColor,
        borderWidth: style.borderTopWidth,
        borderRadius: style.borderTopLeftRadius,
        boxShadow: style.boxShadow,
        opacity: effectiveOpacity(element, slide),
      },
    }),
  };
}

function shouldFallbackElement(element: HTMLElement, style: CSSStyleDeclaration) {
  if (hasVisiblePseudoElement(element)) return true;
  if (element.matches("svg,canvas,video")) return true;
  if (element.matches("img")) return isUnsupportedVisualStyle(style);
  if (element.matches("h1,h2,h3,h4,h5,h6,p,li")) {
    return element.children.length > 0 || isUnsupportedTextStyle(style);
  }
  if (requiresPptxInlineTextFallback({
    tag: element.tagName,
    hasDirectText: hasDirectText(element),
    hasElementChildren: element.children.length > 0,
  })) return true;
  if (shapeTags.has(element.tagName.toLowerCase())) {
    return hasSimpleShapePaint(style) && isUnsupportedVisualStyle(style);
  }
  return false;
}

export function collectPptxElementPlans(slide: HTMLElement): PptxElementPlan[] {
  const slideBox = slide.getBoundingClientRect();
  const view = slide.ownerDocument.defaultView;
  if (!view || !slideBox.width || !slideBox.height) return [];

  const plans: PptxElementPlan[] = [];
  const visit = (element: HTMLElement) => {
    if (element.matches(skippedSelector)) return;
    const style = view.getComputedStyle(element);
    const box = element.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || !isVisibleInsideSlide(box, slideBox)) return;

    if (shouldFallbackElement(element, style)) {
      plans.push({ kind: "fallback", element, frame: elementFrame(slideBox, box) });
      return;
    }

    if (element.matches("img")) {
      plans.push({ kind: "image", element, frame: elementFrame(slideBox, box) });
      return;
    }

    if (element.matches("h1,h2,h3,h4,h5,h6,p,li") || (hasDirectText(element) && element.children.length === 0)) {
      if (element.innerText.trim() && !isUnsupportedTextStyle(style)) plans.push(createTextPlan(element, slide, slideBox, box, style));
      return;
    }

    if (shapeTags.has(element.tagName.toLowerCase()) && hasSimpleShapePaint(style)) {
      plans.push(createShapePlan(element, slide, slideBox, box, style));
    }

    for (const child of Array.from(element.children)) if (isPptxExportElement(child)) visit(child);
  };

  for (const child of Array.from(slide.children)) if (isPptxExportElement(child)) visit(child);
  return plans;
}

export function pptxExportSummary(plans: readonly Pick<PptxElementPlan, "kind">[]) {
  return plans.reduce((summary, plan) => ({
    nativeObjectCount: summary.nativeObjectCount + (plan.kind === "fallback" ? 0 : 1),
    fallbackCount: summary.fallbackCount + (plan.kind === "fallback" ? 1 : 0),
  }), { nativeObjectCount: 0, fallbackCount: 0 });
}

export function validatePptxElementPlanCoverage(input: { hasVisibleContent: boolean; planCount: number }) {
  if (input.hasVisibleContent && input.planCount === 0) {
    return { valid: false as const, reason: "visible-content-not-planned" as const };
  }
  return { valid: true as const };
}

export function slideHasVisiblePptxContent(slide: HTMLElement) {
  const view = slide.ownerDocument.defaultView;
  if (!view) return false;
  const slideBox = slide.getBoundingClientRect();
  return Array.from(slide.querySelectorAll<HTMLElement>("*")).some((element) => {
    if (element.matches(skippedSelector)) return false;
    const style = view.getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity) > 0
      && isVisibleInsideSlide(box, slideBox)
      && (element.children.length === 0 || element.matches("img,svg,canvas,video"));
  });
}

export function needsPptxBackgroundFallback(style: Pick<PptxElementStyle, "backgroundImage" | "filter">) {
  return style.backgroundImage !== "none" || style.filter !== "none";
}

export function collectPptxBackgroundPlan(slide: HTMLElement): PptxBackgroundPlan {
  const deck = slide.closest<HTMLElement>(".deck,[data-ipw-template-kind='slides']") ?? slide;
  const view = deck.ownerDocument.defaultView;
  if (!view) return null;
  const style = view.getComputedStyle(deck);
  const frame = { x: 0, y: 0, w: PPTX_SLIDE_WIDTH_INCHES, h: PPTX_SLIDE_HEIGHT_INCHES };
  if (needsPptxBackgroundFallback(style) || hasVisiblePseudoElement(deck)) return { kind: "fallback", element: deck, frame };
  const color = parseColor(style.backgroundColor);
  return color.transparency < 100 ? { kind: "color", color: color.color } : null;
}
