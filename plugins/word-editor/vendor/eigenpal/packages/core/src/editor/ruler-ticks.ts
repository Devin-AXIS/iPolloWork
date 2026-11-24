// Display-only ruler geometry (interactive-paginated-editing M4.4 / M5.1).
//
// Shared by both adapters: platform-agnostic logic belongs in the engine and is
// called by React and Vue, never duplicated per framework.
//
// The rulers read `Editor.getPageGeometry()` — page boxes in content pixels —
// and nothing else. The legacy rulers worked in twips from `SectionProperties`
// and carried eight margin/indent/tab mutation callbacks; this change owns no
// section-geometry contract, so there are no markers and no drag handles. A
// draggable margin handle that silently does nothing is worse than none.

/** The engine paints at 96 px per inch (twips / 15, 1440 twips per inch). */
export const PX_PER_INCH = 96;
/** Painted pixels per centimetre, derived from {@link PX_PER_INCH}. */
export const PX_PER_CM = PX_PER_INCH / 2.54;

/** Which measurement system the ruler shows. Drives both tick cadence and drag snapping. */
export type RulerUnit = 'inch' | 'cm';

/** One tick on the ruler: where it sits, how tall it is, and its label if it carries one. */
export interface RulerTick {
  /** Offset along the ruler in content pixels. */
  readonly position: number;
  readonly height: number;
  /** Whole-unit label, omitted at the origin and on minor ticks. */
  readonly label?: string;
}

/**
 * Ticks across one page dimension, matching the legacy cadence: eighth-inch
 * minors with labelled inches, or millimetre minors with labelled centimetres.
 */
export function generateRulerTicks(lengthPx: number, unit: RulerUnit): RulerTick[] {
  if (!Number.isFinite(lengthPx) || lengthPx <= 0) return [];
  const ticks: RulerTick[] = [];
  if (unit === 'inch') {
    const step = PX_PER_INCH / 8;
    const count = Math.floor(lengthPx / step);
    for (let i = 0; i <= count; i += 1) {
      const position = i * step;
      if (i % 8 === 0) {
        const inches = i / 8;
        ticks.push({ position, height: 10, ...(inches > 0 ? { label: String(inches) } : {}) });
      } else if (i % 4 === 0) ticks.push({ position, height: 6 });
      else if (i % 2 === 0) ticks.push({ position, height: 4 });
      else ticks.push({ position, height: 2 });
    }
    return ticks;
  }
  const step = PX_PER_CM / 10;
  const count = Math.floor(lengthPx / step);
  for (let i = 0; i <= count; i += 1) {
    const position = i * step;
    if (i % 10 === 0) {
      const cm = i / 10;
      ticks.push({ position, height: 10, ...(cm > 0 ? { label: String(cm) } : {}) });
    } else if (i % 5 === 0) ticks.push({ position, height: 6 });
    else ticks.push({ position, height: 3 });
  }
  return ticks;
}

/** The first page's box, which the rulers measure against. */
export function rulerPageBox(
  pages: readonly { readonly index: number; readonly box: { width: number; height: number } }[]
): { width: number; height: number } | null {
  const first = [...pages].sort((a, b) => a.index - b.index)[0];
  return first ? first.box : null;
}
