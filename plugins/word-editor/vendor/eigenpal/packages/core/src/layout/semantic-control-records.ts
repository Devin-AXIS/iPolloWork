// Content-control records published beside semantic page records: the boundary, lock,
// geometry, and model range of each `w:sdt` that layout placed. Re-exported from
// `semantic-records.ts`, so consumers keep importing them from the record vocabulary.

import type { LayoutBox } from './semantic-records.ts';

/**
 * Raw `w:lock/@w:val` on one control, or `unlocked` when absent / unrecognised.
 *
 * Effective permissions across a nesting chain are the union of every ancestor's lock on two
 * axes (content edit / removal); see {@link ContentControlBoundaryRecord.effectiveLock}.
 */
export type ContentControlLock = 'unlocked' | 'sdtLocked' | 'contentLocked' | 'sdtContentLocked';

/**
 * Mapped control type for layout / chrome — same members as the shipped public
 * `ContentControlType`. Untyped and preserved-only kinds report as `richText`.
 */
export type ContentControlMappedType =
  | 'richText'
  | 'plainText'
  | 'checkbox'
  | 'dropdown'
  | 'comboBox'
  | 'date'
  | 'picture'
  | 'buildingBlockGallery'
  | 'repeatingSection';

/** Where the control sits in the tree relative to its content. */
export type ContentControlLevel = 'block' | 'inline' | 'row' | 'cell';

/**
 * One piece of a control's content geometry.
 *
 * A block control that crosses a page break publishes one fragment per page rather than a
 * single rectangle covering the inter-page gap. An inline control publishes one fragment per
 * LINE it touches, covering the text's vertical extent (line-spacing leading excluded), so a
 * wrapped control never claims the words beside it. Coordinates match fragment boxes
 * (page-content space).
 */
export interface ContentControlGeometryFragment {
  readonly pageIndex: number;
  readonly box: LayoutBox;
}

/**
 * Layout-published boundary for one content control (`w:sdt` / typed `contentControl`).
 *
 * Chrome, lock feedback, and hit resolution read this record — never painted DOM. The wrapper
 * itself is not a layout box; `fragments` cover the content that already flowed in place.
 */
export interface ContentControlBoundaryRecord {
  /** Canonical node id of the control wrapper — not `w:id`. */
  readonly id: string;
  readonly alias?: string;
  readonly tag?: string;
  readonly controlType: ContentControlMappedType;
  /** This control's own `w:lock`, before ancestor union. */
  readonly lock: ContentControlLock;
  /**
   * Nested lock union with every ancestor control, collapsed back to a single `ST_Lock`
   * vocabulary value (both axes locked → `sdtContentLocked`).
   */
  readonly effectiveLock: ContentControlLock;
  /** `w:showingPlcHdr` is present on the control's properties. */
  readonly placeholder: boolean;
  /** `w:dataBinding` is present — content edits are refused as bound. */
  readonly bound: boolean;
  /** 0 for a top-level control; increments through nested wrappers under the shared nesting bound. */
  readonly nestingDepth: number;
  readonly level: ContentControlLevel;
  readonly fragments: readonly ContentControlGeometryFragment[];
  /** An inline control's model offsets in its paragraph; positions map through this, not geometry. */
  readonly range?: ContentControlModelRange;
}

/** `[start, end)` UTF-16 offsets of an inline control's content in one paragraph. */
export interface ContentControlModelRange {
  /** The paragraph that holds the control. */
  readonly paragraphId: string;
  /** Offset of the control's first character. */
  readonly start: number;
  /** Offset just past the control's last character. */
  readonly end: number;
}
