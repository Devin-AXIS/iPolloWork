// Exact shaped glyphs for laid-out spans, using the same policy as measurement.

import type { ResolvedFont } from '../layout/font-resource.ts';
import { displayText } from '../layout/run-style.ts';
import { isOptionalHyphenSpan, paintedSpanText } from '../layout/optional-hyphen-break.ts';
import { styleForFontSlot } from '../layout/script-itemization.ts';
import { layoutFaceHasSmallCaps, shapeLayoutStyleRun } from '../layout/layout-run-shape.ts';
import type { ShapedRun } from '../layout/shaped-run.ts';
import type { LayoutShapingOptions } from '../layout/shaped-measurer.ts';
import type { StyleSpanRecord } from '../layout/semantic-records.ts';
import { isSymbolEncodedFamily } from '../store/package/symbol-encoding.ts';
import {
  describeAdmittedFontIdentity,
  type ExportAdmittedFontIdentity,
} from './document-export-font-resolution.ts';
import {
  createShapingFontResolutionCache,
  resolveShapingFontFace,
} from './export-shaping-font-resolution.ts';
import { ExportResourceError } from './export-session.ts';

/**
 * Exact shaped glyph run and admitted font identity for one published span.
 *
 * The run is shaped at the base size measurement uses. Callers apply the span's drawn-size
 * factor, horizontal scale, and character spacing from {@link StyleSpanRecord.style}.
 * The glyph origin is `span.box.x + (span.glyphOffsetPt ?? 0)`; the offset is
 * already in layout points and must not be scaled a second time by horizontal scale.
 * `font` is a frozen byte-free descriptor; obtain bytes from the session font capability.
 * @public
 */
export interface ExportLaidOutText {
  readonly run: ShapedRun;
  readonly font: ExportAdmittedFontIdentity;
  /** Face descriptors indexed by run.fontSpans when a run needs multiple faces. */
  readonly fonts?: readonly ExportAdmittedFontIdentity[];
  readonly fixedPointScale: number;
}

/** Additive laid-out text shaping for font-backed export sessions and shared shaping. @public */
export interface ExportLaidOutTextApi {
  /**
   * Shape one published span with the same configuration and policy as measurement.
   * Returns null when measurement used the bounded fallback.
   */
  shapeLaidOutText(span: StyleSpanRecord): ExportLaidOutText | null;
}

/** Whether a value publishes {@link ExportLaidOutTextApi}. @public */
export function hasExportLaidOutText<T extends object>(
  value: T
): value is T & ExportLaidOutTextApi {
  return typeof (value as Partial<ExportLaidOutTextApi>).shapeLaidOutText === 'function';
}

/**
 * Whether symbol-face text holds only Unicode twins, which any face with the glyph can draw.
 *
 * An unavailable symbol face keeps its own geometry in layout, while its glyphs are the
 * Unicode twins that `mapSymbolPuaText` produced. Those paint in the default face and its
 * glyph fallbacks. A private-use code or a bare byte (U+0021 to U+00FF) still means a glyph of
 * the symbol face, so a text face would draw a wrong letter; such text stays unpainted.
 */
function isUnicodeTwinText(text: string): boolean {
  for (const glyph of text) {
    const code = glyph.codePointAt(0)!;
    if (code === 0x20) continue;
    if (code <= 0xff || (code >= 0xf000 && code <= 0xf0ff)) return false;
  }
  return true;
}

/**
 * Bind one shaping substrate to the exporter-neutral laid-out text API.
 * @internal
 */
export function bindExportLaidOutText(
  shaping: LayoutShapingOptions
): ExportLaidOutTextApi['shapeLaidOutText'] {
  const resolved = createShapingFontResolutionCache();
  const smallCapsSupportByFont = new WeakMap<ResolvedFont, boolean>();
  return (span: StyleSpanRecord): ExportLaidOutText | null => {
    const faceStyle = styleForFontSlot(span.style, span.fontSlot);
    // An optional hyphen draws `-` only where its line breaks; displayText would always.
    const text = isOptionalHyphenSpan(span)
      ? paintedSpanText(span)
      : displayText(span.text, faceStyle);
    if (text.length === 0) return null;
    const family = faceStyle.fontFamily ?? shaping.defaultFont.family;
    const font =
      resolveShapingFontFace(shaping, resolved, family, faceStyle) ??
      (isSymbolEncodedFamily(family) && isUnicodeTwinText(text)
        ? resolveShapingFontFace(shaping, resolved, shaping.defaultFont.family, faceStyle)
        : null);
    if (!font) return null;
    try {
      if (
        faceStyle.smallCaps &&
        !layoutFaceHasSmallCaps(
          shaping.shaper,
          shaping.environment,
          font,
          faceStyle,
          smallCapsSupportByFont
        )
      ) {
        return null;
      }
      const run = shapeLayoutStyleRun(shaping.shaper, shaping.environment, font, faceStyle, text);
      return Object.freeze({
        run,
        font: describeAdmittedFontIdentity(run.fontSpans[0]?.font ?? font),
        ...(run.fontSpans.length > 1
          ? {
              fonts: Object.freeze(
                run.fontSpans.map((span) => describeAdmittedFontIdentity(span.font))
              ),
            }
          : {}),
        fixedPointScale: shaping.environment.fixedPointScale,
      });
    } catch {
      return null;
    }
  };
}

/**
 * Refuse laid-out shaping after abort or disposal; previously returned records stay readable.
 * @internal
 */
export function bindSessionExportLaidOutText(options: {
  readonly status: () => 'active' | 'aborted' | 'disposed';
  readonly unavailable: () => ExportResourceError;
  readonly shaping: () => ExportLaidOutTextApi | undefined;
}): ExportLaidOutTextApi['shapeLaidOutText'] {
  return (span: StyleSpanRecord): ExportLaidOutText | null => {
    if (options.status() !== 'active') throw options.unavailable();
    return options.shaping()?.shapeLaidOutText(span) ?? null;
  };
}
