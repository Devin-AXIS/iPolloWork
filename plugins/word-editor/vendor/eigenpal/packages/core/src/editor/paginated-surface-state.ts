// What the paginated surface REPORTS: the selection's formatting, the reveal options, and
// the one immutable state value a host subscribes to.
//
// Split out of `paginated-surface-contract.ts`, which sits at its line cap: these types are
// the read side of that contract and change together. The contract re-exports them, so every
// importer keeps one entry point.

import type { ContentControlSurfaceState } from './surface-content-control-contract.ts';
import type { FormatPainterSurfaceState } from './surface-format-painter-contract.ts';
import type { PaginatedSurfacePerf } from './surface-perf-contract.ts';
import type { IndentFormatting } from '../contracts/types.ts';
import type { ScrollPlacement } from '../contracts/editor-anchor.ts';
import type {
  ParagraphDisagreements,
  ParagraphFlags,
  ParagraphTabStop,
} from './paragraph-format-contract.ts';
import type { CollaborationStatus } from '../collaboration/index.ts';
import type { CellSelection, SemanticSelection } from '@docx-editor.dev/core/layout';

/**
 * What the selection is currently formatted as.
 *
 * A value is present only when EVERY span in the selection agrees on it: a selection running
 * from 11pt into 14pt has no font size, and a toolbar should show a blank rather than pick
 * one of the two and imply the whole selection is that.
 */

export interface SurfaceFormatting {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strikethrough: boolean;
  readonly superscript: boolean;
  readonly subscript: boolean;
  readonly fontFamily: string | null;
  /** Half-points, the unit OOXML stores and the picker expects. */
  readonly fontSizeHalfPoints: number | null;
  readonly color: string | null;
  readonly highlight: string | null;
  readonly alignment: 'left' | 'center' | 'right' | 'both' | null;
  /** Paragraph base direction through the cascade; null when the selection mixes them. */
  readonly direction: 'ltr' | 'rtl' | null;
  readonly styleId: string | null;
  /**
   * `w:spacing`'s line rule and its value: LINES for `multiple`, points for the other two
   * (`w:line` is 240ths of a line under `auto` and twentieths of a point otherwise).
   * The effective value: a paragraph whose cascade states none reads as single spacing
   * (`multiple`, 1). Null when the selection's paragraphs disagree.
   */
  readonly lineSpacing: {
    readonly rule: 'multiple' | 'exact' | 'atLeast';
    readonly value: number;
  } | null;
  /** `w:spacing/@w:before` and `@w:after` in points, null when the selection disagrees. */
  readonly spaceBeforePt: number | null;
  readonly spaceAfterPt: number | null;
  /**
   * Effective indent at the selection, in twips, or null with no selection or inside a
   * table.
   *
   * The one field here that does NOT go null on disagreement: the values are the FIRST
   * touched paragraph's and `mixed` reports the disagreement per field, because a ruler
   * must draw its handles somewhere and Word draws them at the first selected paragraph.
   */
  readonly indent: IndentFormatting | null;
  /**
   * The paragraph flags the Paragraph dialog shows as checkboxes, or null when the
   * selection's paragraphs disagree about that one.
   *
   * `contextualSpacing` is "Don't add space between paragraphs of the same style"; the
   * other four are its Pagination block. Each is read from the cascade, so a flag a STYLE
   * sets reads as on — which is what a checkbox has to show.
   */
  readonly paragraphFlags: ParagraphFlags;
  /**
   * The paragraph's resolved custom tab stops, cascade included, or null when the selection
   * disagrees or nothing is loaded. Positions in TWIPS, like every other measurement a
   * control writes back.
   */
  readonly tabStops: readonly ParagraphTabStop[] | null;
  /**
   * Which of the paragraph-level reads above are `null` because the selection DISAGREES,
   * as opposed to because nothing states them. See {@link ParagraphDisagreements}.
   */
  readonly disagrees: ParagraphDisagreements;
}

/** How a reveal places its target in the viewport. */
export interface RevealOptions {
  /**
   * `'start'` puts the target near the top (a heading the user jumped to), `'center'`
   * centres it, `'nearest'` scrolls only when it is out of view — and only far enough to
   * clear the edge, which parks the target flush against it. `'centerIfNeeded'` is the one
   * a jump-to-next-thing control wants: silent while the target is already on screen, and
   * centred when it has to move, so the reader lands looking AT the thing rather than at
   * the bottom line of the window. Default `'start'`.
   */
  readonly block?: ScrollPlacement;
  /** Padding above the target, in CSS pixels. Default 24. */
  readonly offsetPx?: number;
  readonly behavior?: ScrollBehavior;
}

/**
 * How the current selection came to address a drawing — see
 * {@link PaginatedSurface.drawingSelectionIntent}.
 */
export type DrawingSelectionIntent =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'pointer';
      readonly drawingNodeId: string;
      /** A shape inside the group `drawingNodeId`, selected by a second press on the group. */
      readonly memberNodeId?: string;
    }
  | { readonly kind: 'programmatic' };

/**
 * Everything observable about the surface right now, as one immutable value.
 *
 * `revision` is the change token: it moves whenever anything else here does, which is what lets
 * `snapshot()` hand back the same reference until state actually changes.
 */
export interface PaginatedSurfaceState {
  readonly revision: number;
  readonly pageCount: number;
  readonly selection: SemanticSelection;
  /**
   * The rectangle of table cells a drag across cells selected, or null.
   *
   * `selection` always holds the equivalent TEXT range, so a reader that does not care about
   * rectangles needs no branch. This is for the ones that do — the highlight, and table
   * commands that act on cells rather than characters.
   */
  readonly cellSelection: CellSelection | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /**
   * Lifecycle of the attached replica, or `'inactive'` when no collaboration
   * module is registered on this surface.
   */
  readonly collaborationStatus: CollaborationStatus | 'inactive';
  readonly lastRejection: string | null;
  /**
   * The typing format armed at the caret (Word's stored marks), or null.
   *
   * NOT document state — nothing is written until the next characters are typed — but it
   * IS observable state: `formatting()` reports it, so a host that reflects the toolbar
   * has to learn when it moves. Reference-stable while unchanged, so a host can compare
   * it to decide whether to re-derive. See `toggleRunProperty` for the lane itself.
   */
  readonly pendingFormat: readonly { readonly localName: string }[] | null;
  /**
   * Content-control chrome and form-fill mode.
   *
   * Surface-owned (not document bytes). Updates report through the same `onChange` path as
   * selection moves — hosts must not maintain a parallel channel.
   */
  readonly contentControls: ContentControlSurfaceState;
  /**
   * The TOC the last right-click landed on, or null.
   *
   * A TOC refuses the caret entirely, so a right-click on one leaves the caret where it was
   * and `selection` can never say which table of contents the user is pointing at.
   * This is how a host's context menu learns it. Surface chrome, not document state.
   */
  readonly contextTocId: string | null;
  /**
   * Format painter arming, and the level of what it holds.
   *
   * Surface chrome, not document bytes — the lane `contentControls` above sits in, reported
   * through the same `onChange` so a toolbar's pressed state has exactly one source.
   */
  readonly formatPainter: FormatPainterSurfaceState;
  /** Timing and reuse counters for the last pass. Diagnostics, not document state. */
  readonly perf: PaginatedSurfacePerf;
}
