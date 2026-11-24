import { EditorFontError, type FontConfiguration } from '../contracts/editor.ts';
import {
  createLayoutShapedMeasurer,
  FontResolutionError,
  HarfBuzzShapingError,
  fontRequestKey,
  resolveDefaultSurfaceMeasurer,
} from '../layout/index.ts';
import type { LayoutShapingOptions, ResolvedFont, ShapeInput } from '../layout/index.ts';
import { markFacePreservingShaper, preservesShapingFace } from '../layout/shaped-run.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import { fontTableSerifHangulFace } from '../store/package/font-table-alternates.ts';
import { tryCreateBrowserCanvasContext } from './browser-canvas-context.ts';

/**
 * The measurer for the runs that shaping cannot measure. HarfBuzz can only shape faces whose
 * bytes reached its resource snapshot. A run may still name a locally installed browser face
 * (Helvetica is the common macOS case), and a face can lack a glyph: paint resolves those
 * through CSS, so falling back to the deterministic monospace grid makes caret geometry drift.
 * This measures them on the browser canvas with the font stacks that paint uses. Headless
 * environments still receive the fixed measurer.
 */
export function browserFallbackMeasurer(
  container: HTMLElement | null,
  scale: number,
  session: { currentPackage(): OoxmlPackage },
  fontAlias?: (family: string) => string | undefined
) {
  return resolveDefaultSurfaceMeasurer(scale, {
    context: container ? tryCreateBrowserCanvasContext(container.ownerDocument) : null,
    ...(fontAlias ? { fontAlias } : {}),
    serifHangulFace: fontTableSerifHangulFace(session.currentPackage()),
  });
}

export function resolvedFontMeasurement(
  shaping: LayoutShapingOptions,
  fonts: FontConfiguration,
  fallback: ReturnType<typeof resolveDefaultSurfaceMeasurer>,
  scale: number,
  epoch: number,
  onFontError?: (error: EditorFontError) => void,
  /** The family a run renders in while a pick holds its own family (`font-pick-hold.ts`). */
  held?: (family: string) => string | undefined
) {
  const resolvedFonts = new Map<
    string,
    Exclude<ReturnType<typeof shaping.fonts.resolve>, FontResolutionError> | null
  >();
  // Report a face's execution refusal once per measurement owner. Keep the original
  // exception and the bounded fallback; observation must not change layout geometry.
  // Keyed by face and request, not by answer object: a family that falls back to the face
  // gets its own answer object for the same refusal.
  const reportedFonts = new Set<string>();
  const reportKey = (font: ResolvedFont): string => {
    const { family, weight, style } = font.request;
    return `${font.identity}|${family}|${weight}|${style}`;
  };
  const observed = onFontError
    ? {
        shape(input: ShapeInput) {
          try {
            return shaping.shaper.shape(input);
          } catch (error) {
            const font = input.environment.font;
            if (
              error instanceof HarfBuzzShapingError &&
              error.code === 'fontOverLimit' &&
              !reportedFonts.has(reportKey(font))
            ) {
              reportedFonts.add(reportKey(font));
              // The face's own bytes exceed a limit: the same answer as an admission cap, not
              // a shaper that failed to initialize.
              const { family, weight, style } = font.request;
              try {
                onFontError(
                  new EditorFontError('overLimit', error.message, {
                    request: Object.freeze({ family, weight, style }),
                    diagnostic: error.diagnostic ?? error.message,
                    cause: error,
                  })
                );
              } catch {
                // A host diagnostic callback must not replace a shaping refusal.
              }
            }
            throw error;
          }
        },
      }
    : shaping.shaper;
  // It only reports a refusal and rethrows it, so its runs are the wrapped shaper's.
  const shaper =
    observed !== shaping.shaper && preservesShapingFace(shaping.shaper)
      ? markFacePreservingShaper(observed)
      : observed;
  const measurer = createLayoutShapedMeasurer(
    { ...shaping, shaper },
    {
      resolveFont: (style) => {
        // The run family is FILE-DERIVED and reaches `resolve` on every measured run.
        // `resolve` ASSERTS its request (a whitespace-only family throws), and the
        // measurer calls this outside its own guard, so an unusable family must return
        // the fixed fallback here rather than throw through layout — which would fail
        // the remount and take the mounted document with it.
        const authored = style.fontFamily ?? fonts.defaultFont.family;
        const family = held?.(authored) ?? authored;
        if (family.trim().length === 0) return null;
        const request = {
          family,
          weight: style.bold ? 700 : 400,
          style: style.italic ? ('italic' as const) : ('normal' as const),
        };
        const key = fontRequestKey(request);
        if (resolvedFonts.has(key)) return resolvedFonts.get(key) ?? null;
        let resolved: ReturnType<typeof shaping.fonts.resolve>;
        try {
          resolved = shaping.fonts.resolve(request);
        } catch {
          resolvedFonts.set(key, null);
          return null;
        }
        const usable = resolved instanceof FontResolutionError ? null : resolved;
        resolvedFonts.set(key, usable);
        return usable;
      },
      fallback: fallback.measurer,
    }
  );
  // The fallback is part of the geometry producer: the same HarfBuzz faces over a
  // different unresolved-family measurer must never share paragraph-cache entries.
  const producer =
    `shaped:${shaping.operation.extensionFingerprint}` +
    `+algorithm:${shaping.operation.shapingHash}` +
    `+producer:${shaping.operation.producerVersion}` +
    `+fallback:${fallback.producer}@scale:${scale}+fonts:${epoch}`;
  return { measurer, producer };
}
