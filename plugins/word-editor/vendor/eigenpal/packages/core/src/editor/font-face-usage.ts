// The font faces a document's layout measured: each family with the weight and slant that its
// text asks for. The editor sends them to an on-demand font resolver (`FontResolutionRequest
// .faces`), so a resolver loads the bold of a family only when some text is bold.
//
// Layout asks the measurer about every run it lays out, so wrapping the measurer sees exactly
// the faces on the laid-out pages, also the ones an edit adds. One style object stands for many
// runs, and its face is recorded once, so the wrapper adds one `WeakSet` lookup to a measurement.

import type { ResolvedRunStyle, TextMeasurer } from '../layout/index.ts';
import { forwardAuthoredCjkGapMetric } from '../layout/cjk-auto-spacing-metric-port.ts';

/** A face that layout measured. `family` is null for a run that names no font. */
export interface UsedFontFace {
  readonly family: string | null;
  readonly weight: 400 | 700;
  readonly style: 'normal' | 'italic';
}

/** The most faces recorded for one document: a resolver request never needs more. */
export const MAX_USED_FONT_FACES = 512;

/** Records the faces of the text that the wrapped measurers measure. @internal */
export interface FontFaceUsage {
  /** A measurer that records each face it measures, then measures with `measurer`. */
  wrap(measurer: TextMeasurer): TextMeasurer;
  /** The faces recorded, in the order layout first measured them. */
  faces(): readonly UsedFontFace[];
}

/** @internal */
export function createFontFaceUsage(): FontFaceUsage {
  const seen = new WeakSet<ResolvedRunStyle>();
  const faces = new Map<string, UsedFontFace>();
  let list: readonly UsedFontFace[] = [];
  const wrapped = new WeakMap<TextMeasurer, TextMeasurer>();
  const note = (style: ResolvedRunStyle): void => {
    if (seen.has(style)) return;
    seen.add(style);
    if (faces.size >= MAX_USED_FONT_FACES) return;
    const face: UsedFontFace = {
      family: style.fontFamily,
      weight: style.bold ? 700 : 400,
      style: style.italic ? 'italic' : 'normal',
    };
    const key = `${face.family?.trim().toLowerCase() ?? ''}\u0000${face.weight}${face.style}`;
    if (faces.has(key)) return;
    faces.set(key, face);
    list = [...faces.values()];
  };
  return {
    wrap(measurer) {
      const known = wrapped.get(measurer);
      if (known) return known;
      // Every member the measurer has, bound to it, so the wrapper answers exactly the questions
      // the measurer answers, also a host's class-based measurer.
      const wrapper: Record<PropertyKey, unknown> = {};
      const source = measurer as unknown as Record<PropertyKey, unknown>;
      for (
        let o: object | null = measurer;
        o && o !== Object.prototype;
        o = Object.getPrototypeOf(o)
      )
        for (const key of Reflect.ownKeys(o)) {
          if (key === 'constructor' || key in wrapper) continue;
          const value = source[key];
          wrapper[key] = typeof value === 'function' ? value.bind(measurer) : value;
        }
      const measure = measurer.measure.bind(measurer);
      const lineMetrics = measurer.lineMetrics.bind(measurer);
      wrapper.measure = (text: string, style: ResolvedRunStyle) => (
        note(style),
        measure(text, style)
      );
      wrapper.lineMetrics = (style: ResolvedRunStyle, text?: string) => (
        note(style),
        lineMetrics(style, text)
      );
      // Layout keeps one setting by measurer object, the authored CJK gap: it goes along.
      forwardAuthoredCjkGapMetric(measurer, wrapper as unknown as TextMeasurer);
      wrapped.set(measurer, wrapper as unknown as TextMeasurer);
      return wrapper as unknown as TextMeasurer;
    },
    faces: () => list,
  };
}

const usageBySurface = new WeakMap<object, () => readonly UsedFontFace[]>();

/** Record where a surface's used faces come from. Kept off the public surface type. */
export function registerUsedFontFaces(surface: object, faces: () => readonly UsedFontFace[]): void {
  usageBySurface.set(surface, faces);
}

/** The faces that a surface's layout measured, or undefined for a surface with no record. */
export function usedFontFacesOf(surface: object): readonly UsedFontFace[] | undefined {
  return usageBySurface.get(surface)?.();
}

/**
 * Whether every family that laid-out text uses has a face, so the text shows in its own fonts.
 * False before any text is laid out. A run that names no font uses `defaultFamily`.
 */
export function usedFamiliesCovered(
  surface: object | null | undefined,
  defaultFamily: string,
  covered: (family: string) => boolean
): boolean {
  const used = surface ? usedFontFacesOf(surface) : undefined;
  return !!used && used.every((face) => covered(face.family?.trim() ? face.family : defaultFamily));
}
