// Scripts beside a base: subscripts, superscripts, and n-ary limits placed to the right.

import type { EquationGeometry, EquationScriptGeometry } from './equation-layout.ts';
import { equationInk, equationLowercaseTop, inheritEquationInk } from './equation-ink.ts';
import type { LayoutBox, TextMeasurer } from './semantic-records.ts';

// Offsets in ems of the structure size, from the math constants of the default math face
// (2048 font units to the em).
/** The least superscript baseline rise. */
const SUPERSCRIPT_SHIFT_UP = 750 / 2048;
/** How far a superscript baseline may sit below the top of a lowercase base. */
const SUPERSCRIPT_BASELINE_DROP_MAX = 460 / 2048;
/** The least ink gap between a superscript and a subscript of one base. */
const SUB_SUPERSCRIPT_GAP_MIN = 300 / 2048;
/** How high the top of a subscript's ink may reach above the base baseline. */
const SUBSCRIPT_TOP_MAX = 760 / 2048;
/** How high a superscript bottom may rise to open the gap above a subscript. */
const SUPERSCRIPT_BOTTOM_MAX_WITH_SUBSCRIPT = 765 / 2048;

/** A frozen layout box. @internal */
export function box(x: number, y: number, width: number, height: number): LayoutBox {
  return Object.freeze({ x, y, width, height });
}

/** `node` moved to (`x`, `y`), keeping its measured ink. @internal */
export function shifted<T extends EquationGeometry>(node: T, x: number, y: number): T {
  const moved = Object.freeze({
    ...node,
    box: box(x, y, node.box.width, node.box.height),
  }) as unknown as T;
  inheritEquationInk(node, moved);
  return moved;
}

/**
 * Attach a subscript and a superscript to the right of `base`, with offsets in ems of the
 * structure size `em`.
 */
export function attachScripts(
  base: EquationGeometry,
  subscript: EquationGeometry | undefined,
  superscript: EquationGeometry | undefined,
  em: number,
  measurer: TextMeasurer
): EquationScriptGeometry {
  const gap = Math.max(0.4, em * 0.04);
  const scriptX = base.box.width + gap;
  // The superscript baseline rises at least a fixed share of the structure size, and
  // never sits lower than a fixed drop below the top of the base's lowercase text. A
  // text base gives its lowercase height, so an ascender keeps the same rise; a
  // structured base gives the highest lowercase top of its text, such as a numerator.
  let rise = superscript
    ? Math.max(
        SUPERSCRIPT_SHIFT_UP * em,
        equationLowercaseTop(base) - SUPERSCRIPT_BASELINE_DROP_MAX * em
      )
    : 0;
  // The subscript's own baseline sits a fifth of an em below the base baseline, and lower
  // when the top of its ink would rise past a fixed height, as a tall subscript does.
  // A font box standing in for missing glyph ink reaches far above the glyphs, so it
  // says nothing about the limit.
  const subInk = subscript ? equationInk(subscript, measurer) : null;
  const inkTop = subInk && !subInk.fromFontBox ? subInk.ascent : 0;
  let drop = Math.max(em * 0.2, inkTop - SUBSCRIPT_TOP_MAX * em);
  if (superscript && subInk) {
    // Keep an ink gap between the scripts. The superscript rises first, up to a limit,
    // and the subscript drops for the rest.
    const supInk = equationInk(superscript, measurer);
    const missing = SUB_SUPERSCRIPT_GAP_MIN * em - (rise - supInk.descent - (subInk.ascent - drop));
    if (missing > 0) {
      const raised = Math.min(
        missing,
        Math.max(0, SUPERSCRIPT_BOTTOM_MAX_WITH_SUBSCRIPT * em - (rise - supInk.descent))
      );
      rise += raised;
      drop += missing - raised;
    }
  }
  const baseY = superscript ? Math.max(0, superscript.baseline + rise - base.baseline) : 0;
  const baseline = baseY + base.baseline;
  const superscriptY = superscript ? baseline - rise - superscript.baseline : 0;
  const subscriptY = subscript ? Math.max(0, baseline + drop - subscript.baseline) : baseline;
  const width = scriptX + Math.max(subscript?.box.width ?? 0, superscript?.box.width ?? 0, -gap);
  const height = Math.max(
    baseY + base.box.height,
    superscript ? superscriptY + superscript.box.height : 0,
    subscript ? subscriptY + subscript.box.height : 0
  );
  return Object.freeze({
    kind: 'script',
    base: shifted(base, 0, baseY),
    ...(subscript ? { subscript: shifted(subscript, scriptX, subscriptY) } : {}),
    ...(superscript ? { superscript: shifted(superscript, scriptX, superscriptY) } : {}),
    box: box(0, 0, width, height),
    baseline,
  });
}

/** The operators whose limits sit beside them in a display equation without `m:limLoc`. */
const INTEGRALS = /^[\u222b-\u2233\u2a0b-\u2a1c]$/u;

/**
 * True when the limits of an n-ary operator sit to its right as a subscript and superscript.
 * Inline equations always place them there. Display equations follow `m:limLoc`, and without
 * it place the limits of integrals beside and those of other operators below and above.
 */
export function naryLimitsBeside(
  expression: { readonly operator: string; readonly limitLocation?: 'undOvr' | 'subSup' },
  display: boolean
): boolean {
  if (!display) return true;
  return (
    (expression.limitLocation ?? (INTEGRALS.test(expression.operator) ? 'subSup' : 'undOvr')) ===
    'subSup'
  );
}
