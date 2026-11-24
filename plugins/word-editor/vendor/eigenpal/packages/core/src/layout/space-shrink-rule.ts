// Which lines may compress their inter-word spaces to keep one more word, and how far.
import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { paragraphAlignment } from './paragraph-alignment.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import type { CjkTypographySettings } from './cjk-typography.ts';

/**
 * How far each space may shrink under a legacy compatibility rule: down to half its face's
 * average character width (OS/2 `xAvgCharWidth`, the metric of the reverse automatic spacing
 * gap), or down to a quarter of its font size.
 */
export type SpaceShrinkFloor = 'halfAverage' | 'quarterEm';

/**
 * How a line may borrow inter-word space to keep the word that overflows it: how much of
 * each space can go, how the shrink is weighed against the stretch the shorter line would
 * take, and whether a final half-width mark may hang beside spaces at their limit.
 */
export interface SpaceShrinkRule {
  /** The fraction of its natural advance each eligible space may give up. */
  readonly limit: number;
  /**
   * How much more a shrunk space costs than a stretched one. The word joins when `cost` times
   * its shrink per space is at most the stretch per space of the line without it. 0 admits
   * every word that fits within `limit`.
   */
  readonly cost: number;
  /**
   * The share of the advance of a final mark that may hang that the cost test counts. Absent,
   * the whole mark counts.
   */
  readonly markCost?: number;
  /**
   * A word whose final half-width mark may hang joins when the spaces fit the text before the
   * mark, and the mark hangs. Otherwise the word joins only when the mark fits inside too.
   */
  readonly hangsMarks: boolean;
  /**
   * Lines at every alignment shrink their spaces, and a line that does fills the measure as a
   * justified line does.
   */
  readonly everyAlignment?: true;
  /**
   * Each space shrinks down to this floor rather than by `limit`. `limit` applies when the
   * floor is unknown, as a half-average floor is for a face without a known average width.
   */
  readonly floor?: SpaceShrinkFloor;
  /** A space at the balanced width lends nothing (`balancedSpaceShrink`). */
  readonly keepsBalancedSpaces?: true;
}

/** Justified lines (`w:jc` `both`) in a modern compatibility mode. */
export const JUSTIFIED_SPACE_SHRINK: SpaceShrinkRule = Object.freeze({
  limit: 0.25,
  cost: 2,
  hangsMarks: true,
});

/**
 * Distributed lines (`w:jc` `distribute`) in a modern compatibility mode. A shrunk space
 * costs three stretched ones, and the test counts half the advance of a final mark that may
 * hang: the measured rule that admits every word the probes keep and none they wrap.
 */
export const DISTRIBUTED_SPACE_SHRINK: SpaceShrinkRule = Object.freeze({
  limit: 0.25,
  cost: 3,
  markCost: 0.5,
  hangsMarks: true,
});

/** The kashida and Thai distribution values of `w:jc` in a modern compatibility mode. */
const OTHER_JUSTIFIED_SPACE_SHRINK: SpaceShrinkRule = Object.freeze({
  limit: 0.25,
  cost: 2,
  hangsMarks: false,
});

/**
 * Each modern rule with balanced widths. Alignment keeps the balanced spaces at every
 * justified value, so line fitting must not count them either.
 */
const KEEPING_BALANCED_SPACES = new Map(
  [JUSTIFIED_SPACE_SHRINK, DISTRIBUTED_SPACE_SHRINK, OTHER_JUSTIFIED_SPACE_SHRINK].map((rule) => [
    rule,
    Object.freeze({ ...rule, keepsBalancedSpaces: true as const }),
  ])
);

/**
 * A legacy compatibility mode that compresses punctuation (`w:characterSpacingControl`) in a
 * document whose defaults name an East Asian face: each space shrinks down to half its face's
 * average character width (OS/2 `xAvgCharWidth`), without a cost test, at every alignment. A
 * face whose half-average width is wider than its space, such as Calibri, keeps natural spaces;
 * Times New Roman gives about a fifth, Courier New half. Without a known average width, a space
 * gives up a fifth. Only one word per line joins this way, and a space cut at the margin before
 * it counts at its natural advance.
 */
export const COMPRESSED_LEGACY_SPACE_SHRINK: SpaceShrinkRule = Object.freeze({
  limit: 0.2,
  cost: 0,
  hangsMarks: true,
  everyAlignment: true,
  floor: 'halfAverage',
});

/**
 * The legacy rule with `w:balanceSingleByteDoubleByteWidth`: each space shrinks down to a
 * quarter of its font size, whatever its face. A face whose space is a quarter em or less, such
 * as Times New Roman or Calibri, keeps natural spaces; Arial and Century give about a tenth,
 * Courier New more than half.
 */
export const COMPRESSED_BALANCED_SPACE_SHRINK: SpaceShrinkRule = Object.freeze({
  ...COMPRESSED_LEGACY_SPACE_SHRINK,
  floor: 'quarterEm',
});

/** The space-shrink rule of a paragraph, or undefined when its lines keep natural spaces. */
export function resolveSpaceShrinkRule(
  compatibilityMode: number | undefined,
  props: readonly OoxmlProperty[],
  settings?: CjkTypographySettings
): SpaceShrinkRule | undefined {
  if (
    settings?.legacyLineEndPunctuation === true &&
    settings.compression !== 'doNotCompress' &&
    settings.sourceEastAsianFont === true
  )
    // With `w:useWord97LineBreakRules` as well, proportional faces keep natural spaces.
    // Monospaced faces then shrink further, by a rule not modeled here; they keep theirs too.
    return !settings.balancedWidths
      ? COMPRESSED_LEGACY_SPACE_SHRINK
      : settings.word97LineBreaks
        ? undefined
        : COMPRESSED_BALANCED_SPACE_SHRINK;
  // Modern justification is mode 15 and every newer mode. An absent mode stays legacy.
  if (
    !hasCompatibilityRule(compatibilityMode, 'justifiedSpaceShrink') ||
    paragraphAlignment(props) !== 'both'
  )
    return undefined;
  const jc = props.filter((prop) => prop.localName === 'jc').at(-1)?.attributes?.val;
  const rule =
    jc === 'both'
      ? JUSTIFIED_SPACE_SHRINK
      : jc === 'distribute'
        ? DISTRIBUTED_SPACE_SHRINK
        : OTHER_JUSTIFIED_SPACE_SHRINK;
  const keeping = settings?.balancedSpaceShrink ? KEEPING_BALANCED_SPACES.get(rule) : undefined;
  return keeping ?? rule;
}
