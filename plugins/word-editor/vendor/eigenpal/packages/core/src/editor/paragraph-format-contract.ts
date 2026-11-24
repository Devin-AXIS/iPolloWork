// The Paragraph dialog's data contract (paginated-surface seam).
//
// Split out of paginated-surface-contract.ts, which is at its line cap. These are the
// types a paragraph-formatting control reads and writes: one batched form submission and
// one raw property edit. Re-exported from paginated-surface-contract.ts so importers keep
// one entry point.
//
// The tri-state flags and the tab stop come from the CONTRACT lane and are re-exported
// rather than restated. One declaration per concept: two public names for one shape is a
// trap, and so is one name for two shapes.

import type { ParagraphTabStop } from '../contracts/types.ts';

export type {
  ParagraphDisagreements,
  ParagraphFlags,
  ParagraphTabStop,
} from '../contracts/types.ts';

/**
 * Every field of the Paragraph dialog, in the units the rest of this contract uses:
 * points for spacing, TWIPS for indents.
 *
 * An omitted field is left as authored. Where `null` is allowed it REMOVES the setting,
 * which is not the same as writing a zero — a zero blocks the cascade, a removal lets the
 * style through again.
 */
export interface SurfaceParagraphFormat {
  readonly alignment?: 'left' | 'center' | 'right' | 'both';
  /** Base direction; see `directionalParagraphEntry` for what each value writes. */
  readonly direction?: 'ltr' | 'rtl';
  readonly spaceBeforePt?: number | null;
  readonly spaceAfterPt?: number | null;
  readonly lineSpacing?: {
    readonly rule: 'multiple' | 'exact' | 'atLeast';
    readonly value: number;
  } | null;
  readonly indentLeftTwips?: number | null;
  readonly indentRightTwips?: number | null;
  /** ONE signed first-line offset: negative is a hanging indent (§17.3.1.12). */
  readonly indentFirstLineTwips?: number | null;
  readonly contextualSpacing?: boolean;
  readonly keepNext?: boolean;
  readonly keepLines?: boolean;
  readonly widowControl?: boolean;
  readonly pageBreakBefore?: boolean;
  /**
   * Replace the paragraph's custom tab stops. An empty list CLEARS them, which is what Word's
   * "Clear All" does; omit the field to leave them as authored.
   */
  readonly tabStops?: readonly ParagraphTabStop[];
}

/** One property in a batched paragraph write. */
export interface ParagraphPropertyEdit {
  readonly localName: string;
  /** A null-valued attribute REMOVES that attribute; see `setParagraphProperty`. */
  readonly attributes?: Record<string, string | null>;
  /** Keep the attributes this entry does not name, for multi-setting elements. */
  readonly mergeAttributes?: boolean;
  /**
   * For `w:jc` only: `attributes.val` names a PHYSICAL edge, as a toolbar button does. The
   * writer converts it per paragraph, because a bidi paragraph reaches its right margin
   * with `left` (see `jcValueForAlignment`).
   */
  readonly physicalAlignment?: boolean;
  /**
   * For `w:bidi` only: the base direction the paragraph must END in. The writer spells it per
   * paragraph and skips one already in that direction (see `directionalParagraphEntry`).
   */
  readonly paragraphDirection?: 'ltr' | 'rtl';
  /** Drop the paragraph's own element of this name instead of writing one. */
  readonly remove?: boolean;
}
