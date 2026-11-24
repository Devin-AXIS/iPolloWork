// The watermark shape box. `setWatermark` writes it, and the Watermark dialog preview draws
// it, so the preview shows the box the command will write and not an estimate of its own.
import type { Watermark } from '../contracts/types';
import { DEFAULT_RUN_STYLE } from '../layout/run-style.ts';
import type { TextMeasurer } from '../layout/text-measurer.ts';
import {
  sniffImageMime,
  validateRasterHeader,
  type SupportedImageMime,
} from '../store/package/image-resources.ts';

/** The font a text watermark uses when its options name none. @public */
export const DEFAULT_WATERMARK_FONT = 'Calibri';

/** The picture formats a watermark accepts, by sniffed signature. */
export const WATERMARK_PICTURE_MIMES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/bmp',
  'image/webp',
]);

/** Largest shape side written; a page is far smaller. */
const MAX_SIDE_PT = 4000;

/** A width and a height in points. @public */
export interface WatermarkSize {
  readonly width: number;
  readonly height: number;
}

const clampSide = (value: number) => Math.max(1, Math.min(MAX_SIDE_PT, value));

/**
 * The text watermark box. A fixed size is the text's advance by its line height. Auto fits
 * that proportion to the text area: across it, or for a diagonal watermark with the turned
 * box spanning the shorter side of the area. Without a measurer, the advance is 0.55 em per
 * character and the line is 1.22 em.
 */
function textBox(
  text: string,
  options: {
    fontFamily: string;
    bold: boolean;
    italic: boolean;
    size: number | null;
    diagonal: boolean;
  },
  area: WatermarkSize,
  measurer: TextMeasurer | undefined
): WatermarkSize {
  const style = {
    ...DEFAULT_RUN_STYLE,
    fontFamily: options.fontFamily,
    bold: options.bold,
    italic: options.italic,
    fontSizePt: options.size ?? 100,
  };
  let advance = measurer?.measure(text, style) ?? NaN;
  let line = measurer?.lineMetrics(style).height ?? NaN;
  if (!(advance > 0)) advance = 0.55 * style.fontSizePt * Array.from(text).length;
  if (!(line > 0)) line = 1.22 * style.fontSizePt;
  if (options.size !== null) return { width: clampSide(advance), height: clampSide(line) };
  const ratio = line / advance;
  // A box turned 45 degrees spans (width + height) / sqrt(2) both across and down, so a
  // diagonal fits the shorter side of the text area: the width of a portrait page, the
  // height of a landscape one.
  const span = Math.min(area.width, area.height);
  const width = options.diagonal ? (span * Math.SQRT2) / (1 + ratio) : area.width;
  return { width: clampSide(width), height: clampSide(width * ratio) };
}

/** The picture watermark box: its natural size times the scale, or fitted to the text area. */
function pictureBox(
  bytes: Uint8Array,
  scale: number | null,
  area: WatermarkSize
): WatermarkSize | null {
  const mime = sniffImageMime(bytes);
  if (!WATERMARK_PICTURE_MIMES.has(mime)) return null;
  const header = validateRasterHeader(bytes, mime as SupportedImageMime);
  if (!header) return null;
  const width = (header.pixelWidth * 72) / (header.dpiX && header.dpiX > 0 ? header.dpiX : 96);
  const height = (header.pixelHeight * 72) / (header.dpiY && header.dpiY > 0 ? header.dpiY : 96);
  if (!(width > 0) || !(height > 0)) return null;
  const factor = scale ?? Math.min(area.width / width, area.height / height);
  return { width: clampSide(width * factor), height: clampSide(height * factor) };
}

/**
 * The shape box, in points, that `setWatermark` writes for `watermark` on a page whose text
 * area (page size less margins) is `area`. The box is centered on the text area, and a
 * diagonal text box turns 45 degrees counterclockwise about its center. Null when the
 * options name no text and no readable picture. Pass a measurer for the exact text
 * advance; without one the advance is an estimate.
 *
 * @example
 * ```ts
 * const box = watermarkShapeBox({ text: 'DRAFT' }, { width: 468, height: 648 });
 * ```
 * @public
 */
export function watermarkShapeBox(
  watermark: Watermark,
  area: WatermarkSize,
  measurer?: TextMeasurer
): WatermarkSize | null {
  if (watermark.imageData) return pictureBox(watermark.imageData, watermark.scale ?? null, area);
  const text = watermark.text ?? '';
  if (text === '') return null;
  return textBox(
    text,
    {
      fontFamily: watermark.fontFamily?.trim() || DEFAULT_WATERMARK_FONT,
      bold: watermark.bold ?? false,
      italic: watermark.italic ?? false,
      size: watermark.fontSizePt ?? null,
      diagonal: (watermark.layout ?? 'diagonal') === 'diagonal',
    },
    area,
    measurer
  );
}
