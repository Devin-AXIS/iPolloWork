export const PPTX_SLIDE_WIDTH_INCHES = 13.333;
export const PPTX_SLIDE_HEIGHT_INCHES = 7.5;
export const PPTX_BACKGROUND_IMAGE_FORMAT = "image/png";
export const PPTX_CAPTURE_SCALE = 2;

export const PPTX_EXPORT_CONFIRMATION = {
  title: "可编辑优先导出 PPTX",
  message: "文字、图片和基础形状会保留为可编辑的 PowerPoint 对象；复杂视觉效果将以局部图片保留。",
  confirmLabel: "导出 PPTX",
  cancelLabel: "取消",
};

type PptxRectangle = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PptxTextStyle = {
  color: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
  lineHeight: string;
  letterSpacing: string;
  opacity: number;
};

export type PptxTextOverlay = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  fontFace: string;
  lineSpacing?: number;
  charSpacing?: number;
  lang?: "zh-CN";
  color: string;
  transparency: number;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right" | "justify";
};

type CreatePptxTextOverlayInput = {
  text: string;
  slide: PptxRectangle;
  box: PptxRectangle;
  style: PptxTextStyle;
};

export type PptxTextOverlayElement = {
  element: HTMLElement;
  overlay: PptxTextOverlay;
};

export type PptxVisualShadow = {
  type: "outer";
  color: string;
  opacity: number;
  blur: number;
  offset: number;
  angle: number;
};

export type PptxShapeOverlay = {
  shape: "rect" | "roundRect";
  x: number;
  y: number;
  w: number;
  h: number;
  rectRadius?: number;
  fill: { color: string; transparency: number };
  line: { color: string; transparency: number; width: number };
  shadow?: PptxVisualShadow;
};

export type PptxShapeOverlayElement = {
  element: HTMLElement;
  overlay: PptxShapeOverlay;
};

type PptxShapeStyle = {
  backgroundColor: string;
  borderColor: string;
  borderWidth: string;
  borderRadius: string;
  boxShadow: string;
  opacity: number;
};

type CreatePptxShapeOverlayInput = {
  slide: PptxRectangle;
  box: PptxRectangle;
  style: PptxShapeStyle;
};

type PptxTextStyleCompatibilityInput = {
  text: string;
  hasElementChildren: boolean;
  isMarkedForPptxText?: boolean;
  hasVisualAncestor?: boolean;
  transform: string;
  filter: string;
  textShadow: string;
  backgroundClip: string;
  webkitBackgroundClip: string;
};

function round(value: number) {
  return Number(value.toFixed(3));
}

function parseColor(value: string) {
  if (!value || value === "transparent") return { color: "000000", transparency: 100 };
  const hexadecimal = value.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hexadecimal) {
    const expanded = hexadecimal.length === 3 || hexadecimal.length === 4
      ? hexadecimal.split("").map((part) => `${part}${part}`).join("")
      : hexadecimal;
    const color = expanded.slice(0, 6).toUpperCase();
    const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6), 16) / 255 : 1;
    return { color, transparency: Math.round((1 - alpha) * 100) };
  }

  const match = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (!match) return { color: "111827", transparency: 0 };
  const channels = match.slice(1, 4).map((channel) => Math.max(0, Math.min(255, Number(channel))));
  const alpha = match[4] == null ? 1 : Math.max(0, Math.min(1, Number(match[4])));
  return {
    color: channels.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase(),
    transparency: Math.round((1 - alpha) * 100),
  };
}

function combineTransparency(colorTransparency: number, opacity: number) {
  const alpha = (1 - colorTransparency / 100) * Math.max(0, Math.min(1, opacity));
  return Math.round((1 - alpha) * 100);
}

function normalizeAlign(value: string): PptxTextOverlay["align"] {
  if (value === "center" || value === "right" || value === "justify") return value;
  return "left";
}

function fontFace(value: string, text: string) {
  const faces = value.split(",").map((part) => part.trim().replace(/["']/g, "")).filter(Boolean);
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(text)) {
    const cjkFace = faces.find((face) => /(?:noto\s+(?:serif|sans)\s+sc|microsoft\s+yahei|source\s+han|sim(?:sun|hei)|songti|fangsong|kaiti)/i.test(face));
    if (cjkFace) return cjkFace;
    return /serif/i.test(value) ? "Noto Serif SC" : "Noto Sans SC";
  }
  return faces[0] || "Arial";
}

function fontSizePoints(value: string) {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? round(pixels * 0.75) : 12;
}

function pointValue(value: string) {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? round(pixels * 0.75) : undefined;
}

function cssPixels(value: string) {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : 0;
}

function shapeCoordinates(slide: PptxRectangle, box: PptxRectangle) {
  return {
    x: round((box.left - slide.left) / slide.width * PPTX_SLIDE_WIDTH_INCHES),
    y: round((box.top - slide.top) / slide.height * PPTX_SLIDE_HEIGHT_INCHES),
    w: round(box.width / slide.width * PPTX_SLIDE_WIDTH_INCHES),
    h: round(box.height / slide.height * PPTX_SLIDE_HEIGHT_INCHES),
  };
}

export function createPptxVisualShadow(value: string): PptxVisualShadow | undefined {
  if (!value || value === "none" || value.includes("inset")) return undefined;
  const color = value.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i)?.[0];
  if (!color) return undefined;
  const remaining = value.replace(color, "");
  if (remaining.includes(",")) return undefined;
  const values = remaining.match(/-?\d*\.?\d+px/g)?.map((part) => Number.parseFloat(part));
  if (!values || values.length < 3) return undefined;
  const [offsetX, offsetY, blur] = values;
  const shadowColor = parseColor(color);
  const offset = Math.hypot(offsetX, offsetY) * 0.75;
  const angle = (Math.atan2(-offsetY, offsetX) * 180 / Math.PI + 360) % 360;
  return {
    type: "outer",
    color: shadowColor.color,
    opacity: round(1 - shadowColor.transparency / 100),
    blur: round(blur * 0.75),
    offset: round(offset),
    angle: Math.round(angle),
  };
}

export function createPptxShapeOverlay(input: CreatePptxShapeOverlayInput): PptxShapeOverlay {
  const fill = parseColor(input.style.backgroundColor);
  const line = parseColor(input.style.borderColor);
  const opacity = Math.max(0, Math.min(1, input.style.opacity));
  const borderRadius = cssPixels(input.style.borderRadius);
  const dimensions = shapeCoordinates(input.slide, input.box);
  const size = Math.max(1, Math.min(input.box.width, input.box.height));
  return {
    shape: borderRadius > 0 ? "roundRect" : "rect",
    ...dimensions,
    ...(borderRadius > 0 ? { rectRadius: round(Math.min(1, borderRadius / size * 2)) } : {}),
    fill: {
      color: fill.color,
      transparency: combineTransparency(fill.transparency, opacity),
    },
    line: {
      color: line.color,
      transparency: combineTransparency(line.transparency, opacity),
      width: pointValue(input.style.borderWidth) ?? 0,
    },
    ...(createPptxVisualShadow(input.style.boxShadow) ? { shadow: createPptxVisualShadow(input.style.boxShadow) } : {}),
  };
}

export function deckPptxFileName(baseName: string) {
  const clean = baseName.replace(/\.(?:pdf|pptx)$/i, "").trim() || "presentation";
  return `${clean}.pptx`;
}

export function createPptxTextOverlay(input: CreatePptxTextOverlayInput): PptxTextOverlay {
  const { slide, box, style } = input;
  const color = parseColor(style.color);
  const lineSpacing = pointValue(style.lineHeight);
  const charSpacing = pointValue(style.letterSpacing);
  return {
    text: input.text,
    x: round((box.left - slide.left) / slide.width * PPTX_SLIDE_WIDTH_INCHES),
    y: round((box.top - slide.top) / slide.height * PPTX_SLIDE_HEIGHT_INCHES),
    w: round(box.width / slide.width * PPTX_SLIDE_WIDTH_INCHES),
    h: round(box.height / slide.height * PPTX_SLIDE_HEIGHT_INCHES),
    fontSize: fontSizePoints(style.fontSize),
    fontFace: fontFace(style.fontFamily, input.text),
    ...(lineSpacing == null ? {} : { lineSpacing }),
    ...(charSpacing == null ? {} : { charSpacing }),
    ...(/[\u3400-\u9fff\uf900-\ufaff]/.test(input.text) ? { lang: "zh-CN" as const } : {}),
    color: color.color,
    transparency: combineTransparency(color.transparency, style.opacity),
    bold: Number.parseInt(style.fontWeight, 10) >= 600 || style.fontWeight === "bold",
    italic: style.fontStyle === "italic",
    align: normalizeAlign(style.textAlign),
  };
}

export function isPptxTextStyleCompatible(input: PptxTextStyleCompatibilityInput) {
  if (!input.text || (input.hasElementChildren && !input.isMarkedForPptxText)) return false;
  if (input.transform !== "none" || input.filter !== "none" || input.textShadow !== "none") return false;
  return input.backgroundClip !== "text" && input.webkitBackgroundClip !== "text";
}

function hasUnsupportedVisualAncestor(element: HTMLElement, slide: HTMLElement) {
  const view = element.ownerDocument.defaultView;
  for (let current = element.parentElement; current && current !== slide; current = current.parentElement) {
    const style = view?.getComputedStyle(current);
    if (!style) continue;
    if (
      style.transform !== "none"
      || style.filter !== "none"
      || style.backdropFilter !== "none"
      || style.mixBlendMode !== "normal"
      || style.backgroundImage !== "none"
      || style.clipPath !== "none"
      || style.maskImage !== "none"
      || (style.boxShadow !== "none" && createPptxVisualShadow(style.boxShadow) == null)
    ) {
      return true;
    }
  }
  return false;
}

type PptxShapeStyleCompatibilityInput = Pick<
  CSSStyleDeclaration,
  | "backgroundColor"
  | "borderTopColor"
  | "borderRightColor"
  | "borderBottomColor"
  | "borderLeftColor"
  | "borderTopWidth"
  | "borderRightWidth"
  | "borderBottomWidth"
  | "borderLeftWidth"
  | "boxShadow"
  | "transform"
  | "filter"
  | "backdropFilter"
  | "mixBlendMode"
  | "backgroundImage"
  | "clipPath"
  | "maskImage"
>;

export function isPptxShapeStyleCompatible(style: PptxShapeStyleCompatibilityInput) {
  const hasVisibleFill = parseColor(style.backgroundColor).transparency < 100;
  const borderWidths = [
    cssPixels(style.borderTopWidth),
    cssPixels(style.borderRightWidth),
    cssPixels(style.borderBottomWidth),
    cssPixels(style.borderLeftWidth),
  ];
  const hasBorder = borderWidths.every((width) => width > 0);
  const hasShadow = createPptxVisualShadow(style.boxShadow) != null;
  if (!hasVisibleFill && !hasBorder && !hasShadow) return false;
  return style.transform === "none"
    && style.filter === "none"
    && style.backdropFilter === "none"
    && style.mixBlendMode === "normal"
    && style.backgroundImage === "none"
    && style.clipPath === "none"
    && style.maskImage === "none";
}

export function collectPptxShapeOverlays(slide: HTMLElement): PptxShapeOverlayElement[] {
  const slideBox = slide.getBoundingClientRect();
  const view = slide.ownerDocument.defaultView;
  if (!slideBox.width || !slideBox.height || !view) return [];

  return Array.from(slide.querySelectorAll<HTMLElement>("div,article,aside,section,header,footer,main"))
    .filter((element) => {
      const style = view.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return isPptxShapeStyleCompatible(style)
        && box.width > 1
        && box.height > 1
        && box.left >= slideBox.left
        && box.top >= slideBox.top
        && box.right <= slideBox.right
        && box.bottom <= slideBox.bottom;
    })
    .map((element) => {
      const style = view.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        element,
        overlay: createPptxShapeOverlay({
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

export function collectPptxTextOverlays(slide: HTMLElement): PptxTextOverlayElement[] {
  const slideBox = slide.getBoundingClientRect();
  if (!slideBox.width || !slideBox.height) return [];

  return Array.from(slide.querySelectorAll<HTMLElement>("[data-ipw-text],h1,h2,h3,h4,h5,h6,p,li"))
    .filter((element) => {
      const isMarkedForPptxText = element.hasAttribute("data-ipw-text");
      if (!isMarkedForPptxText && element.parentElement?.closest("[data-ipw-text]")) return false;
      const style = slide.ownerDocument.defaultView?.getComputedStyle(element);
      return Boolean(style && isPptxTextStyleCompatible({
        text: element.textContent?.trim() ?? "",
        hasElementChildren: element.children.length > 0,
        isMarkedForPptxText,
        hasVisualAncestor: hasUnsupportedVisualAncestor(element, slide),
        transform: style.transform,
        filter: style.filter,
        textShadow: style.textShadow,
        backgroundClip: style.backgroundClip,
        webkitBackgroundClip: style.webkitBackgroundClip,
      }));
    })
    .map((element) => {
      const style = slide.ownerDocument.defaultView?.getComputedStyle(element);
      if (!style) throw new Error("Could not read presentation text styles.");
      const box = element.getBoundingClientRect();
      return {
        element,
        overlay: createPptxTextOverlay({
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
    });
}

export function hidePptxEditableText(overlays: PptxTextOverlayElement[]) {
  const previous = overlays.map(({ element }) => ({ element, color: element.style.color }));
  for (const { element } of previous) element.style.color = "transparent";
  return () => {
    for (const { element, color } of previous) element.style.color = color;
  };
}

export function hidePptxEditableShapes(overlays: PptxShapeOverlayElement[]) {
  const previous = overlays.map(({ element }) => ({
    element,
    backgroundColor: element.style.backgroundColor,
    borderColor: element.style.borderColor,
    borderWidth: element.style.borderWidth,
    boxShadow: element.style.boxShadow,
    outline: element.style.outline,
  }));
  for (const { element } of previous) {
    element.style.backgroundColor = "transparent";
    element.style.borderColor = "transparent";
    element.style.borderWidth = "0";
    element.style.boxShadow = "none";
    element.style.outline = "none";
  }
  return () => {
    for (const { element, backgroundColor, borderColor, borderWidth, boxShadow, outline } of previous) {
      element.style.backgroundColor = backgroundColor;
      element.style.borderColor = borderColor;
      element.style.borderWidth = borderWidth;
      element.style.boxShadow = boxShadow;
      element.style.outline = outline;
    }
  };
}
