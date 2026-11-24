import type { DocRange } from './types';

/**
 * The hyperlink under a position: where it points, how far it reaches, and what Word shows on
 * hover.
 *
 * `href` has already been through `sanitizeHref` — it comes from a file, so a `javascript:` or
 * `data:` target is dropped at the parse boundary rather than here.
 */
export interface HyperlinkInfo {
  readonly href: string;
  readonly range: DocRange;
  /**
   * `w:tooltip` on the `w:hyperlink` — the text Word shows on hover, and what the
   * hyperlink dialog seeds its tooltip field with when editing an existing link.
   */
  readonly tooltip?: string;
}

/**
 * Section page setup — size, orientation and margins, in twips — as `getPageSetup()`
 * and `snapshot().pageSetup` report it and the `setPageSetup` command writes it. In a
 * multi-section document this is the setup of the section the SELECTION is in, which
 * is what a ruler or a dialog reflects — Word's behaviour.
 */
export interface PageSetup {
  readonly pageWidthTwips: number;
  readonly pageHeightTwips: number;
  readonly orientation: 'portrait' | 'landscape';
  readonly marginsTwips: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  /** Binding gutter (`w:gutter`), folded into the left margin by layout. */
  readonly gutterTwips?: number;
}
