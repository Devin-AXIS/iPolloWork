import type { ParagraphTabStop } from '../contracts/types.ts';

/** One tri-state paragraph flag: on, off, or "the selection disagrees". @public */
export type ParagraphFlagState = boolean | null;

/**
 * What the Paragraph dialog reads: every field, as the selection currently stands.
 *
 * A `null` means the selection's paragraphs DISAGREE about that field, which a control
 * shows as an indeterminate checkbox or an empty box rather than as a value. `indent` is
 * the exception the engine already documents — it reports the first touched paragraph and
 * flags disagreement per field, because a ruler has to draw its handles somewhere.
 *
 * @public
 */
export interface ParagraphFormatRead {
  /**
   * `justify`, not OOXML's `both`. The engine speaks `w:jc` values; an adapter speaks the
   * word its consumers write. Read and write use the SAME spelling here, so a value that
   * comes out of `format` can go straight back into `apply`.
   */
  readonly alignment: 'left' | 'center' | 'right' | 'justify' | null;
  /** Base direction (`w:bidi` through the cascade); null when the selection mixes them. */
  readonly direction: 'ltr' | 'rtl' | null;
  readonly spaceBeforePt: number | null;
  readonly spaceAfterPt: number | null;
  readonly lineSpacing: {
    readonly rule: 'multiple' | 'exact' | 'atLeast';
    readonly value: number;
  } | null;
  readonly indentLeftTwips: number | null;
  readonly indentRightTwips: number | null;
  /** ONE signed first-line offset: negative is a hanging indent. */
  readonly indentFirstLineTwips: number | null;
  readonly contextualSpacing: ParagraphFlagState;
  readonly keepNext: ParagraphFlagState;
  readonly keepLines: ParagraphFlagState;
  readonly widowControl: ParagraphFlagState;
  readonly pageBreakBefore: ParagraphFlagState;
  /** Custom tab stops, cascade included. Null when the selection disagrees. */
  readonly tabStops: readonly ParagraphTabStop[] | null;
  /**
   * Which fields are `null` because the selection DISAGREES, as opposed to because nothing
   * states them.
   *
   * A `null` alone cannot tell those apart, and both readings shipped as bugs: a
   * disagreement rendered as a concrete value is uncorrectable, because the value that
   * would fix it is the one already on screen; an absent value rendered as "mixed" tells a
   * single paragraph it disagrees with itself.
   */
  readonly disagrees: {
    readonly alignment: boolean;
    readonly direction: boolean;
    readonly spaceBeforePt: boolean;
    readonly spaceAfterPt: boolean;
    readonly lineSpacing: boolean;
    readonly tabStops: boolean;
    readonly indentLeft: boolean;
    readonly indentRight: boolean;
    readonly indentFirstLine: boolean;
  };
  /**
   * Whether the indent reads are UNKNOWN rather than disagreed.
   *
   * The engine reports no indent at all for a paragraph inside a table — correct, but not
   * placeable on a ruler. A control must not call that "mixed": one paragraph cannot
   * disagree with itself, and the commonest paragraph in a real document is in a cell.
   */
  readonly indentUnknown: boolean;
}

/**
 * The fields `apply` accepts. Omitted fields are left as authored; `null` where allowed
 * REMOVES the setting so the style supplies it again, which is not the same as a zero.
 *
 * @public
 */
export interface ParagraphFormatUpdate {
  readonly alignment?: 'left' | 'center' | 'right' | 'justify';
  /** Word's Direction. `ltr` overrides a right-to-left style with `w:bidi w:val="0"`. */
  readonly direction?: 'ltr' | 'rtl';
  readonly spaceBeforePt?: number | null;
  readonly spaceAfterPt?: number | null;
  readonly lineSpacing?: {
    readonly rule: 'multiple' | 'exact' | 'atLeast';
    readonly value: number;
  } | null;
  readonly indentLeftTwips?: number | null;
  readonly indentRightTwips?: number | null;
  readonly indentFirstLineTwips?: number | null;
  readonly contextualSpacing?: boolean;
  readonly keepNext?: boolean;
  readonly keepLines?: boolean;
  readonly widowControl?: boolean;
  readonly pageBreakBefore?: boolean;
  /** Replace the custom tab stops. An EMPTY list clears them; omit to leave them alone. */
  readonly tabStops?: readonly ParagraphTabStop[];
}
