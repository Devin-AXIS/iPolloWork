// The document watermark: `getWatermark()`, the `watermark` query and `setWatermark`.
//
// The package lane (`store/package/watermark-package.ts`) owns the markup. This lane turns the
// public options into the shape box a text watermark uses, from the text's measured advance
// and line height and the section's text area, and validates every option before anything
// is written.
import type { ExecResult, Watermark, WatermarkState } from '../contracts/types';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { SurfaceLifecycleOp } from './surface-hf-editing.ts';
import { validateEmbeddedImageBytes } from '../store/package/drawing-package-edit.ts';
import { sniffImageMime, type SupportedImageMime } from '../store/package/image-resources.ts';
import { MAX_TEXT_ART_LENGTH } from '../store/package/legacy-vml-text-art.ts';
import {
  readPackageWatermark,
  type PackageWatermarkSize,
  type PackageWatermarkWrite,
} from '../store/package/watermark-package.ts';
import { enumerateDocumentSections, type SectionProperties } from '../layout/section-properties.ts';
import type { TextMeasurer } from '../layout/text-measurer.ts';
import {
  DEFAULT_WATERMARK_FONT,
  WATERMARK_PICTURE_MIMES,
  watermarkShapeBox,
  type WatermarkSize,
} from './watermark-geometry.ts';

const DEFAULT_COLOR = 'C0C0C0';
const DEFAULT_TRANSPARENCY = 0.5;
const FONT_FAMILY = /^[^"';{}<>\\\u0000-\u001f]{1,64}$/u;

/** The watermark the document shows, for the dialog. */
export function watermarkOf(surface: PaginatedSurface | null): WatermarkState | null {
  if (!surface) return null;
  const reading = readPackageWatermark(surface.session.currentPackage());
  if (!reading) return null;
  if (reading.kind === 'picture') return Object.freeze({ kind: 'image', washout: reading.washout });
  return Object.freeze({
    kind: 'text',
    text: reading.text,
    fontFamily: reading.fontFamily,
    fontSizePt: reading.fontSizePt,
    bold: reading.bold,
    italic: reading.italic,
    color: reading.colorHex,
    transparency: Math.round((1 - reading.opacity) * 1000) / 1000,
    layout: reading.diagonal ? 'diagonal' : 'horizontal',
  });
}

/** The `watermark` query: the same reading, with a picture's bytes so it can be written back. */
export function watermarkQueryOf(surface: PaginatedSurface | null): Watermark | null {
  const state = watermarkOf(surface);
  if (!state || !surface) return null;
  if (state.kind === 'text') {
    const { kind: _kind, ...text } = state;
    return Object.freeze(text);
  }
  const pkg = surface.session.currentPackage();
  const reading = readPackageWatermark(pkg);
  const bytes =
    reading?.kind === 'picture' && reading.mediaPartName
      ? pkg.partBytes.get(reading.mediaPartName)
      : undefined;
  return Object.freeze({
    washout: state.washout ?? false,
    scale: null,
    ...(bytes ? { imageData: bytes } : {}),
  });
}

const isFiniteIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Why `watermark` cannot be written, or null when it can. Every option is checked. */
export function watermarkRefusal(watermark: unknown): string | null {
  if (watermark === null) return null;
  if (typeof watermark !== 'object' || watermark === undefined)
    return 'watermark must be an object or null';
  const w = watermark as Record<string, unknown>;
  const hasText = w.text !== undefined;
  const hasImage = w.imageData !== undefined;
  if (hasText === hasImage) return 'set exactly one of text and imageData';
  if (hasText) {
    if (typeof w.text !== 'string' || !w.text.trim()) return 'text must be a non-empty string';
    if (w.text.length > MAX_TEXT_ART_LENGTH) return `text is longer than ${MAX_TEXT_ART_LENGTH}`;
    if (/[\r\n\v\f\u2028\u2029]/u.test(w.text)) return 'text must be one line';
    if (/[\u0000-\u0008\u000e-\u001f]/u.test(w.text)) return 'text holds a control character';
    if (
      w.fontFamily !== undefined &&
      (typeof w.fontFamily !== 'string' || !FONT_FAMILY.test(w.fontFamily.trim()))
    )
      return 'fontFamily is not a font name';
    if (w.fontSizePt !== undefined && w.fontSizePt !== null && !isFiniteIn(w.fontSizePt, 1, 1000))
      return 'fontSizePt must be from 1 to 1000';
    if (w.color !== undefined && (typeof w.color !== 'string' || !/^[0-9a-f]{6}$/iu.test(w.color)))
      return 'color must be RRGGBB';
    if (w.transparency !== undefined && !isFiniteIn(w.transparency, 0, 1))
      return 'transparency must be from 0 to 1';
    if (w.layout !== undefined && w.layout !== 'diagonal' && w.layout !== 'horizontal')
      return "layout must be 'diagonal' or 'horizontal'";
    for (const key of ['bold', 'italic'])
      if (w[key] !== undefined && typeof w[key] !== 'boolean') return `${key} must be a boolean`;
    if (w.scale !== undefined || w.washout !== undefined)
      return 'scale and washout apply to a picture watermark';
    return null;
  }
  if (!(w.imageData instanceof Uint8Array)) return 'imageData must be a Uint8Array';
  const mime = sniffImageMime(w.imageData);
  if (!WATERMARK_PICTURE_MIMES.has(mime))
    return 'imageData is not a PNG, JPEG, GIF, BMP or WebP picture';
  if (!validateEmbeddedImageBytes(w.imageData, mime as SupportedImageMime))
    return 'imageData is not a readable picture';
  if (w.scale !== undefined && w.scale !== null && !isFiniteIn(w.scale, 0.01, 10))
    return 'scale must be from 0.01 to 10';
  if (w.washout !== undefined && typeof w.washout !== 'boolean') return 'washout must be a boolean';
  for (const key of [
    'fontFamily',
    'fontSizePt',
    'bold',
    'italic',
    'color',
    'transparency',
    'layout',
  ])
    if (w[key] !== undefined) return `${key} applies to a text watermark`;
  return null;
}

/** A section's text area in points: the page less its margins and gutter, as layout uses. */
function sectionTextArea(section: SectionProperties): WatermarkSize {
  const { pageSize, margins } = section;
  const width =
    (pageSize.widthTwips - margins.leftTwips - margins.rightTwips - margins.gutterTwips) / 20;
  const height = (pageSize.heightTwips - margins.topTwips - margins.bottomTwips) / 20;
  return { width: Math.max(72, width), height: Math.max(72, height) };
}

/**
 * The shape size for every body section, by canonical section index, so each header fits the
 * page of the section that shows it: a landscape section gets a landscape fit.
 */
function sectionSizes(
  mounted: PaginatedSurface,
  watermark: Watermark,
  measurer: TextMeasurer | undefined
): readonly (PackageWatermarkSize | null)[] | undefined {
  const pkg = mounted.session.currentPackage();
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return undefined;
  return enumerateDocumentSections(main).map((section) => {
    const box = watermarkShapeBox(watermark, sectionTextArea(section.properties), measurer);
    return box ? { widthPt: box.width, heightPt: box.height } : null;
  });
}

/** The package write for validated options. */
export function watermarkWrite(
  mounted: PaginatedSurface,
  watermark: Watermark
): PackageWatermarkWrite | null {
  const area = sectionTextArea(
    mounted.sectionPropertiesAt(mounted.state().selection.head.paragraphId)
  );
  const measurer = mounted.textMeasurer?.();
  if (watermark.imageData) {
    const mime = sniffImageMime(watermark.imageData) as SupportedImageMime;
    const box = watermarkShapeBox(watermark, area);
    if (!box) return null;
    return {
      kind: 'picture',
      washout: watermark.washout ?? true,
      widthPt: box.width,
      heightPt: box.height,
      sectionSizes: sectionSizes(mounted, watermark, measurer),
      image: { bytes: watermark.imageData, mime },
    };
  }
  const text = watermark.text ?? '';
  const fontFamily = watermark.fontFamily?.trim() || DEFAULT_WATERMARK_FONT;
  const bold = watermark.bold ?? false,
    italic = watermark.italic ?? false;
  const diagonal = (watermark.layout ?? 'diagonal') === 'diagonal';
  const size = watermark.fontSizePt ?? null;
  // Validated text is never blank, so the shared rule always returns a box.
  const box = watermarkShapeBox(watermark, area, measurer)!;
  return {
    kind: 'text',
    text,
    fontFamily,
    fontSizePt: size,
    bold,
    italic,
    colorHex: (watermark.color ?? DEFAULT_COLOR).toUpperCase(),
    opacity: 1 - (watermark.transparency ?? DEFAULT_TRANSPARENCY),
    diagonal,
    widthPt: box.width,
    heightPt: box.height,
    sectionSizes: sectionSizes(mounted, watermark, measurer),
  };
}

/** `setWatermark`: one package write and one undo step, or a refusal that writes nothing. */
export function execSetWatermark(
  mounted: PaginatedSurface,
  watermark: Watermark | null
): ExecResult {
  const refusal = watermarkRefusal(watermark);
  if (refusal) return { ok: false, code: 'invalidArgs', reason: refusal };
  if (typeof mounted.applyHeaderFooterLifecycle !== 'function')
    return { ok: false, code: 'unsupported', reason: 'watermarks are not available' };
  const write = watermark ? watermarkWrite(mounted, watermark) : null;
  if (watermark && !write)
    return { ok: false, code: 'invalidArgs', reason: 'imageData is not a readable picture' };
  if (!watermark && !readPackageWatermark(mounted.session.currentPackage()))
    return { ok: true, changed: false };
  const op: SurfaceLifecycleOp = { op: 'setWatermark', watermark: write };
  const result = mounted.applyHeaderFooterLifecycle(op);
  if (!result.ok)
    return {
      ok: false,
      code: result.reason === 'locked' ? 'locked' : 'invalidArgs',
      reason: `the watermark was not written: ${result.reason}`,
    };
  return { ok: true, changed: true };
}
