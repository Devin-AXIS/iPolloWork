import { HARD_MAX_FONT_BYTES, assertValidatedResolvedFont } from './font-resource.ts';
import { HarfBuzzShapingError } from './harfbuzz-shaper.ts';
import {
  LAYOUT_HARFBUZZ_SHAPER_POLICY,
  type LayoutHarfBuzzShaperPolicy,
} from './layout-shaper-policy.ts';
import {
  markFacePreservingShaper,
  preservesShapingFace,
  type ShapeInput,
  type TextShaper,
} from './shaped-run.ts';

/** Host-selected execution limits, separate from font admission limits. @public */
export interface FontShapingOptions {
  /** Per-face shaping byte ceiling. Defaults to 16 MiB; the hard ceiling is 64 MiB. */
  readonly maxFontBytes?: number;
}

/** Sample one explicit host execution ceiling before asynchronous initialization. @internal */
export function fontShapingPolicy(
  options: FontShapingOptions | undefined,
  base: LayoutHarfBuzzShaperPolicy = LAYOUT_HARFBUZZ_SHAPER_POLICY
): LayoutHarfBuzzShaperPolicy {
  const maxFontBytes = options?.maxFontBytes ?? base.maxFontBytes;
  if (
    !Number.isSafeInteger(maxFontBytes) ||
    maxFontBytes <= 0 ||
    maxFontBytes > HARD_MAX_FONT_BYTES
  ) {
    throw new RangeError(`Font shaping byte ceiling must be between 1 and ${HARD_MAX_FONT_BYTES}`);
  }
  return maxFontBytes === base.maxFontBytes ? base : Object.freeze({ ...base, maxFontBytes });
}

/** Apply a host refusal before consulting a shared native shaper or its caches. @internal */
export function withFontShapingPolicy(
  shaper: TextShaper,
  policy: LayoutHarfBuzzShaperPolicy,
  ownsShaper = false
): TextShaper & { dispose(): void } {
  let disposed = false;
  const wrapped = Object.freeze({
    shape(input: ShapeInput) {
      if (disposed) throw new HarfBuzzShapingError('disposed');
      const font = input.environment.font;
      assertValidatedResolvedFont(font);
      if (font.byteLength > policy.maxFontBytes) {
        throw new HarfBuzzShapingError('fontOverLimit', {
          limit: policy.maxFontBytes,
          actual: font.byteLength,
        });
      }
      return shaper.shape(input);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (ownsShaper) (shaper as TextShaper & { dispose?: () => void }).dispose?.();
    },
  });
  // It only refuses input; the runs it returns are the wrapped shaper's.
  return preservesShapingFace(shaper) ? markFacePreservingShaper(wrapped) : wrapped;
}
