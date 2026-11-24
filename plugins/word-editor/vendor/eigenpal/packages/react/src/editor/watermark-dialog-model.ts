// The Watermark dialog's framework-neutral model, byte-identical in both adapters.
//
// The draft is plain data. `seedWatermarkFields` reads it from the document's current
// watermark, and `watermarkFromFields` turns it back into the ONE `setWatermark` value the
// dialog sends, so both adapters agree on every default and every conversion.

import type { PageSetup, Watermark, WatermarkState } from '@docx-editor.dev/core/contracts/editor';
import { watermarkShapeBox } from '@docx-editor.dev/core/editor';

/** How a text watermark crosses the page. @public */
export type WatermarkDialogLayout = NonNullable<WatermarkState['layout']>;

/** Which watermark the dialog writes. @public */
export type WatermarkDialogKind = 'none' | 'picture' | 'text';

/** The Watermark dialog draft. Transparency is 0 to 1, color is `RRGGBB`. @public */
export interface WatermarkDialogFields {
  kind: WatermarkDialogKind;
  /** The picture bytes, or null when no picture is chosen. */
  imageData: Uint8Array | null;
  /** The chosen file name. Null for no picture or for the document's current picture. */
  imageName: string | null;
  /** A factor of the picture's natural size. Null is Auto. */
  scale: number | null;
  washout: boolean;
  text: string;
  fontFamily: string;
  /** Points. Null is Auto. */
  fontSizePt: number | null;
  bold: boolean;
  italic: boolean;
  transparency: number;
  color: string;
  layout: WatermarkDialogLayout;
}

/** The text choices the dialog offers when the host passes no `presets`. @public */
export const DEFAULT_WATERMARK_PRESETS: readonly string[] = [
  'ASAP',
  'CONFIDENTIAL',
  'COPY',
  'DO NOT COPY',
  'DRAFT',
  'ORIGINAL',
  'PERSONAL',
  'SAMPLE',
  'TOP SECRET',
  'URGENT',
];

/** Picture scale choices. Null is Auto. */
export const WATERMARK_SCALES: readonly (number | null)[] = [null, 0.5, 1, 1.5, 2, 5];

/** Text size choices in points. Null is Auto. */
export const WATERMARK_SIZES: readonly (number | null)[] = [
  null,
  36,
  40,
  44,
  48,
  54,
  60,
  66,
  72,
  80,
  90,
  96,
  105,
  120,
  144,
];

/** File types the picture chooser accepts. */
export const WATERMARK_IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/bmp,image/webp';

export const DEFAULT_WATERMARK_FIELDS: Readonly<WatermarkDialogFields> = {
  kind: 'none',
  imageData: null,
  imageName: null,
  scale: null,
  washout: true,
  text: 'DRAFT',
  fontFamily: 'Calibri',
  fontSizePt: null,
  bold: false,
  italic: false,
  transparency: 0.5,
  color: 'C0C0C0',
  layout: 'diagonal',
};

const HEX = /^[0-9A-Fa-f]{6}$/;

/** The draft for the document's current watermark. `full` carries the picture bytes. */
export function seedWatermarkFields(
  state: WatermarkState | null,
  full: Watermark | null
): WatermarkDialogFields {
  const base: WatermarkDialogFields = { ...DEFAULT_WATERMARK_FIELDS };
  if (!state) return base;
  if (state.kind === 'image') {
    return {
      ...base,
      kind: full?.imageData ? 'picture' : 'none',
      imageData: full?.imageData ?? null,
      scale: full?.scale ?? null,
      washout: state.washout ?? full?.washout ?? true,
    };
  }
  return {
    ...base,
    kind: 'text',
    text: state.text ?? base.text,
    fontFamily: state.fontFamily ?? base.fontFamily,
    fontSizePt: state.fontSizePt ?? null,
    bold: state.bold ?? false,
    italic: state.italic ?? false,
    transparency: state.transparency ?? base.transparency,
    color: state.color && HEX.test(state.color) ? state.color.toUpperCase() : base.color,
    layout: state.layout ?? base.layout,
  };
}

/**
 * The `setWatermark` value for a draft. Null removes the watermark. Undefined means the
 * draft cannot be applied yet: a picture without bytes, or empty text.
 */
export function watermarkFromFields(fields: WatermarkDialogFields): Watermark | null | undefined {
  if (fields.kind === 'none') return null;
  if (fields.kind === 'picture') {
    if (!fields.imageData) return undefined;
    return { imageData: fields.imageData, scale: fields.scale, washout: fields.washout };
  }
  if (fields.text.trim() === '') return undefined;
  return {
    text: fields.text,
    fontFamily: fields.fontFamily,
    fontSizePt: fields.fontSizePt,
    bold: fields.bold,
    italic: fields.italic,
    color: fields.color,
    transparency: fields.transparency,
    layout: fields.layout,
  };
}

/** `#rrggbb` for a color input. */
export const colorInputValue = (color: string): string =>
  `#${HEX.test(color) ? color.toLowerCase() : 'c0c0c0'}`;

/** `RRGGBB` from a color input value, or null when it is not a six-digit color. */
export function colorFromInput(value: string): string | null {
  const hex = value.startsWith('#') ? value.slice(1) : value;
  return HEX.test(hex) ? hex.toUpperCase() : null;
}

/** Whole percent, 0 to 100, for a 0 to 1 transparency. */
export const transparencyPercent = (transparency: number): number =>
  Math.round(Math.min(1, Math.max(0, transparency)) * 100);

/** 0 to 1 from a percent input. Non-numbers keep the previous value. */
export function transparencyFromPercent(value: string, previous: number): number {
  const parsed = Number(value);
  if (value.trim() === '' || !Number.isFinite(parsed)) return previous;
  return Math.min(100, Math.max(0, Math.round(parsed))) / 100;
}

/** Whether two `getWatermark()` reads describe the same watermark. */
export function watermarkStateEqual(a: WatermarkState | null, b: WatermarkState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind &&
    a.text === b.text &&
    a.fontFamily === b.fontFamily &&
    a.fontSizePt === b.fontSizePt &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.color === b.color &&
    a.transparency === b.transparency &&
    a.layout === b.layout &&
    a.washout === b.washout
  );
}

/**
 * The draft an Apply is compared with, or null when every Apply must write. A document
 * watermark the dialog cannot show (a picture without readable bytes) seeds as No
 * watermark, and Apply on that draft must still remove it.
 */
export function watermarkBaseline(
  state: WatermarkState | null,
  seeded: WatermarkDialogFields
): WatermarkDialogFields | null {
  return state !== null && seeded.kind === 'none' ? null : seeded;
}

/**
 * Whether two drafts write the same watermark. Only the fields of the chosen kind count,
 * and picture bytes compare by identity, so a newly chosen file is always a change.
 */
export function watermarkFieldsEqual(a: WatermarkDialogFields, b: WatermarkDialogFields): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'none') return true;
  if (a.kind === 'picture')
    return a.imageData === b.imageData && a.scale === b.scale && a.washout === b.washout;
  return (
    a.text === b.text &&
    a.fontFamily === b.fontFamily &&
    a.fontSizePt === b.fontSizePt &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.color.toUpperCase() === b.color.toUpperCase() &&
    a.transparency === b.transparency &&
    a.layout === b.layout
  );
}

/** The preset select's value for a text: the preset itself, or `''` for Custom. */
export const watermarkPresetValue = (text: string, presets: readonly string[]): string =>
  presets.includes(text) ? text : '';

/** A rectangle in points on the preview page. */
export interface WatermarkPreviewRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The preview page in points: the section's page and its text area (page less margins). */
export interface WatermarkPreviewPage {
  readonly width: number;
  readonly height: number;
  readonly area: WatermarkPreviewRect;
}

/** US Letter with one-inch margins, for an editor that reports no page setup. */
const FALLBACK_PAGE_SETUP: PageSetup = {
  pageWidthTwips: 12240,
  pageHeightTwips: 15840,
  orientation: 'portrait',
  marginsTwips: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
};

/**
 * The preview page for the caret's section, the same section `setWatermark` sizes the
 * shape against. The text area is at least one inch on each side, as in the command.
 */
export function watermarkPreviewPage(setup: PageSetup | null | undefined): WatermarkPreviewPage {
  const page = setup && setup.pageWidthTwips > 0 && setup.pageHeightTwips > 0 ? setup : null;
  const { pageWidthTwips, pageHeightTwips, marginsTwips } = page ?? FALLBACK_PAGE_SETUP;
  const width = pageWidthTwips / 20;
  const height = pageHeightTwips / 20;
  const areaWidth = Math.max(72, (pageWidthTwips - marginsTwips.left - marginsTwips.right) / 20);
  const areaHeight = Math.max(72, (pageHeightTwips - marginsTwips.top - marginsTwips.bottom) / 20);
  return {
    width,
    height,
    area: {
      x: marginsTwips.left / 20,
      y: marginsTwips.top / 20,
      width: areaWidth,
      height: areaHeight,
    },
  };
}

/** Height of one placeholder body line on the preview page, in points. */
export const WATERMARK_PREVIEW_LINE_HEIGHT = 12;

/** Relative widths of the placeholder lines; `0` leaves a paragraph gap. */
const PREVIEW_LINE_PATTERN = [0.55, 1, 1, 0.9, 0, 1, 1, 0.6, 0, 1, 0.95, 1, 0.45];

/** Placeholder body lines that fill the text area, as rectangles in points. */
export function watermarkPreviewLines(page: WatermarkPreviewPage): readonly WatermarkPreviewRect[] {
  const { area } = page;
  const pitch = 36;
  const lines: WatermarkPreviewRect[] = [];
  for (let i = 0, y = area.y; y + WATERMARK_PREVIEW_LINE_HEIGHT <= area.y + area.height; i++) {
    const share = PREVIEW_LINE_PATTERN[i % PREVIEW_LINE_PATTERN.length]!;
    if (share > 0)
      lines.push({
        x: area.x,
        y,
        width: area.width * share,
        height: WATERMARK_PREVIEW_LINE_HEIGHT,
      });
    y += pitch;
  }
  return lines;
}

/**
 * CSS filter for a washed-out picture: brightness +70% and contrast -70% as one linear
 * transfer per channel, `out = 0.3 * in + 0.805`, which keeps white at white. CSS
 * `contrast(c) brightness(b)` is `b * (c * in + (1 - c) / 2)`, so `b = 0.3 + 2 * 0.805`
 * and `c = 0.3 / b`. The page paints a washed-out picture with the same filter.
 */
export const WATERMARK_WASHOUT_FILTER = 'contrast(0.157068) brightness(1.91)';

/** The text the preview draws, in points on the preview page. */
export interface WatermarkPreviewText {
  readonly text: string;
  /** A CSS font family list. */
  readonly fontFamily: string;
  readonly fontWeight: 'bold' | 'normal';
  readonly fontStyle: 'italic' | 'normal';
  /** `#RRGGBB`. */
  readonly fill: string;
  readonly opacity: number;
  /** The unrotated shape box, centered on the text area, as `setWatermark` writes it. */
  readonly box: WatermarkPreviewRect;
  /** Degrees about the box center; negative turns counterclockwise. */
  readonly rotation: number;
}

/** Glyph ink bounds of the text drawn at `WATERMARK_PREVIEW_FONT_SIZE`, baseline at 0. */
export interface WatermarkPreviewInk {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The size the preview draws its text at before the fit scales the ink into the box. */
export const WATERMARK_PREVIEW_FONT_SIZE = 100;

const round2 = (value: number) => Math.round(value * 100) / 100;
const center = (page: WatermarkPreviewPage) => ({
  cx: page.area.x + page.area.width / 2,
  cy: page.area.y + page.area.height / 2,
});

/**
 * The preview of a text draft, or null when the draft is not a text watermark or its text
 * is blank. The shape box comes from `watermarkShapeBox`, the rule `setWatermark` writes
 * with, so Auto and fixed sizes, both layouts, and the page's text area all match the page.
 */
export function watermarkPreviewText(
  fields: WatermarkDialogFields,
  page: WatermarkPreviewPage = watermarkPreviewPage(null)
): WatermarkPreviewText | null {
  if (fields.kind !== 'text') return null;
  const text = fields.text.trim();
  if (text === '') return null;
  const box = watermarkShapeBox(
    {
      text,
      fontFamily: fields.fontFamily,
      fontSizePt: fields.fontSizePt,
      bold: fields.bold,
      italic: fields.italic,
      layout: fields.layout,
    },
    page.area
  );
  if (!box) return null;
  const { cx, cy } = center(page);
  return {
    text,
    // A family the browser lacks falls back to sans-serif, the shape of the default fonts,
    // not to the browser's serif default. Quotes and backslashes cannot end the name.
    fontFamily: `"${fields.fontFamily.replace(/["\\]/g, '')}", sans-serif`,
    fontWeight: fields.bold ? 'bold' : 'normal',
    fontStyle: fields.italic ? 'italic' : 'normal',
    fill: `#${HEX.test(fields.color) ? fields.color.toUpperCase() : 'C0C0C0'}`,
    opacity: round2(1 - Math.min(1, Math.max(0, fields.transparency))),
    box: {
      x: round2(cx - box.width / 2),
      y: round2(cy - box.height / 2),
      width: round2(box.width),
      height: round2(box.height),
    },
    rotation: fields.layout === 'diagonal' ? -45 : 0,
  };
}

const inkContexts = new WeakMap<Document, CanvasRenderingContext2D | null>();

/** One measuring canvas per document: a pop-out editor measures with its own window's fonts. */
function inkContextOf(doc: Document | null): CanvasRenderingContext2D | null {
  if (!doc) return null;
  let context = inkContexts.get(doc);
  if (context === undefined) {
    try {
      context = doc.createElement('canvas').getContext('2d');
    } catch {
      context = null;
    }
    inkContexts.set(doc, context);
  }
  return context;
}

/**
 * The glyph ink of the preview text, measured on a canvas in `doc`, the editor's document.
 * Without a canvas the ink is an estimate: 0.55 em per character across and 0.7 em above
 * the baseline.
 */
export function watermarkPreviewInk(
  text: WatermarkPreviewText,
  doc: Document | null
): WatermarkPreviewInk {
  const size = WATERMARK_PREVIEW_FONT_SIZE;
  const inkContext = inkContextOf(doc);
  if (inkContext) {
    inkContext.font = `${text.fontStyle} ${text.fontWeight} ${size}px ${text.fontFamily}`;
    const metrics = inkContext.measureText(text.text);
    const left = -(metrics.actualBoundingBoxLeft ?? 0);
    const right = metrics.actualBoundingBoxRight ?? metrics.width;
    const top = -(metrics.actualBoundingBoxAscent ?? 0);
    const bottom = metrics.actualBoundingBoxDescent ?? 0;
    if (right > left && bottom > top) return { left, right, top, bottom };
  }
  return {
    left: 0,
    right: 0.55 * size * Array.from(text.text).length,
    top: -0.7 * size,
    bottom: 0,
  };
}

/**
 * The SVG transform that draws the text, set at `WATERMARK_PREVIEW_FONT_SIZE` with its
 * baseline origin at 0, the way the page does: the glyph ink stretched to fill the shape
 * box inside the text inset (7.2 points left and right, 3.6 top and bottom), then the box
 * turned about its center.
 */
export function watermarkPreviewTextTransform(
  text: WatermarkPreviewText,
  ink: WatermarkPreviewInk
): string {
  const { x, y, width, height } = text.box;
  // A box too small for the inset keeps its whole area for the ink.
  const insetX = width > 4 * 7.2 ? 7.2 : 0;
  const insetY = height > 4 * 3.6 ? 3.6 : 0;
  const scaleX = (width - 2 * insetX) / (ink.right - ink.left);
  const scaleY = (height - 2 * insetY) / (ink.bottom - ink.top);
  const offsetX = x + insetX - ink.left * scaleX;
  const offsetY = y + insetY - ink.top * scaleY;
  const n = (value: number) => String(Math.round(value * 10000) / 10000);
  const fit = `matrix(${n(scaleX)} 0 0 ${n(scaleY)} ${n(offsetX)} ${n(offsetY)})`;
  if (!text.rotation) return fit;
  return `rotate(${text.rotation} ${n(x + width / 2)} ${n(y + height / 2)}) ${fit}`;
}

/**
 * Where the preview draws a picture draft, or null when the draft is not a picture
 * watermark or its bytes are not a readable picture. Auto fits the text area and a scale
 * multiplies the natural size, through the same rule as `setWatermark`.
 */
export function watermarkPreviewPicture(
  fields: WatermarkDialogFields,
  page: WatermarkPreviewPage = watermarkPreviewPage(null)
): WatermarkPreviewRect | null {
  if (fields.kind !== 'picture' || !fields.imageData) return null;
  const box = watermarkShapeBox({ imageData: fields.imageData, scale: fields.scale }, page.area);
  if (!box) return null;
  const { cx, cy } = center(page);
  return {
    x: round2(cx - box.width / 2),
    y: round2(cy - box.height / 2),
    width: round2(box.width),
    height: round2(box.height),
  };
}
