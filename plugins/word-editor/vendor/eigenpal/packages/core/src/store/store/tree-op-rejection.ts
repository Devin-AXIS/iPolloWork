// Why a tree op was refused: the stable rejection codes every op validator and applier returns.

/**
 * Why an op was refused.
 *
 * `not-adjacent-siblings` is the notable one: a join across table cells is refused rather than
 * silently merging content out of the cell that owned it.
 */
export type TreeOpRejection =
  | 'unknown-op'
  | 'unknown-paragraph'
  | 'not-a-paragraph'
  | 'offset-out-of-range'
  | 'invalid-range'
  | 'not-a-list-paragraph'
  | 'splits-surrogate-pair'
  | 'invalid-text'
  | 'unsupported-property'
  | 'invalid-property-value'
  | 'not-adjacent-siblings'
  /**
   * The addressed position is strictly inside content nothing can divide: a hyperlink, an
   * inline content control, a revision wrapper, or an atomic field.
   *
   * Distinct from `invalid-range`, which is an offset the paragraph does not have. This one is
   * a real offset that is not a PLACE — refused rather than resolved to the nearest one, so a
   * caller learns the node would not have landed where they asked.
   */
  | 'indivisible-content'
  /**
   * The range has one end inside a field's editable saved result and the other outside it.
   * Deleting it would leave the field's begin, separate, and end markers unbalanced, so it is
   * refused. A range that covers the whole field removes the field.
   */
  | 'field-structure'
  /**
   * In the editable field-result mode, an op other than typing, deletion, or run formatting
   * addresses a position inside a field's saved result. Splits, tabs, links, notes, and
   * fragments there are not supported yet.
   */
  | 'field-result-unsupported'
  | 'unknown-block'
  | 'not-a-block'
  | 'block-required'
  | 'carries-section-mark'
  /**
   * The removal would leave a body, note or text box ending with a table. Such a story ends
   * with a paragraph after the table, as a cell does (`ooxml-story-end-repair.ts`).
   */
  | 'story-end-paragraph'
  /** The transaction named a part the package does not hold. */
  | 'unknown-part'
  /**
   * The transaction would have published a package that does not open: a relationship
   * pointing at a part nobody created, or a part with no declared content type.
   */
  | 'package-invariant'
  /**
   * A package edit refused the package it was given, for example because an id or part name it
   * expected to allocate is taken or a definition it addresses changed. Nothing was applied.
   */
  | 'package-changed'
  /** No revision in this part carries the addressed `(id, author, date)` triple. */
  | 'unknown-revision'
  /**
   * A matched revision is a kind whose accept/reject semantics are structural and not
   * implemented. Refusing is deliberate: removing the markup alone would report the decision
   * applied while leaving the row, cell, or section it describes untouched.
   */
  | 'unsupported-revision'
  /**
   * A tracked insertion would land inside a link, content control, or other container within
   * another author's pending insertion. The container cannot split, and nested words would
   * become part of that author's proposal.
   */
  | 'unsupported-revision:foreign-insertion'
  | 'tree-invariant'
  /** No content control in this part carries the addressed node id. */
  | 'unknown-content-control'
  /** The addressed node exists and is not a `w:sdt`. */
  | 'not-a-content-control'
  /**
   * A content control's `w:lock` — or one an enclosing control imposes — forbids this.
   *
   * The same code for an edit inside `contentLocked` content and for the removal of an
   * `sdtLocked` control: both are "the document says no", and the two halves are already
   * distinguished by which operation was refused.
   */
  | 'locked'
  /** The control declares `w:dataBinding`; its value belongs to a custom XML part. */
  | 'bound'
  /** The value offered is not one this control's type accepts. */
  | 'typeMismatch'
  | 'unknown-control'
  | 'unsupported'
  /** Malformed lifecycle args / first-section link — mirrors Editor `invalidArgs`. */
  | 'invalidArgs'
  /** The addressed table id is missing, duplicated, or not a typed table. */
  | 'unknown-table'
  /** The addressed row id is missing or not a direct child of the table. */
  | 'unknown-row'
  /** A table property container appears more than once on a typed node. */
  | 'duplicate-property-container'
  /**
   * A row holds a `w:tc` inside a cell-level wrapper such as `w:sdt`, so the row's grid
   * mapping cannot be trusted and the inserted row would not match it.
   */
  | 'row-hides-cell'
  /** The table carries a legacy `w:hMerge`, which grid edits cannot place. */
  | 'table-has-merge'
  /** The cells to merge do not cover one rectangle, or cover only one cell. */
  | 'cells-not-rectangle'
  /** A cell merged over several rows splits only into a divisor of them. */
  | 'split-rows-not-divisor'
  /** The cells hold a tracked cell insertion, deletion, or merge. */
  | 'cell-has-revision'
  /** The split cells would be narrower than the minimum column width. */
  | 'cell-too-narrow'
  /** A whole-cell value write addresses a cell that is not one plain paragraph. */
  | 'unsupported-cell-content'
  /** Without `w:tblGrid`, a cell splits only into a divisor of the columns it spans. */
  | 'split-needs-grid'
  /** The addressed grid column id is missing or ambiguous without `w:tblGrid`. */
  | 'unknown-grid-column'
  /** The operation would exceed bounded table topology limits. */
  | 'resource-limit'
  /** The addressed node is not a top-level `w:drawing`. */
  | 'not-a-drawing'
  /** No `w:drawing` with this id exists in the part. */
  | 'unknown-drawing'
  /** The drawing's graphic payload is not a supported picture. */
  | 'not-a-picture-drawing'
  /** The drawing holds no shape whose fill and outline can be set: a picture, chart or diagram. */
  | 'not-a-shape-drawing'
  /**
   * A fill write without a colour (a transparency, or showing a fill again) on a shape with no
   * solid fill to keep or bring back. It never invents one: the write needs a colour.
   */
  | 'no-solid-fill'
  /** A chart in any state: only a delete applies, and it removes the whole chart. */
  | 'chart-drawing'
  /** A lock flag or `@locked` forbids this mutation. */
  | 'drawing-locked'
  /** Finite EMU extent, crop, or position value is out of range. */
  | 'invalid-drawing-value'
  /** Insertion would cross a table-cell boundary or wrong story container. */
  | 'cross-cell-drawing'
  /** Suggesting-mode drawing deletion is not implemented in this change. */
  | 'trackedDrawingDeletionUnsupported'
  /** Hyperlink target creation or change needs an OPC relationship in a package transaction. */
  | 'packageTransactionRequired'
  /** A clipboard fragment block nests deeper than the recursion cap. */
  | 'fragment-too-deep'
  /** A clipboard fragment block is not a paragraph, table, or content control subtree. */
  | 'fragment-invalid-block'
  /** A clipboard fragment exceeds its block or node budget. */
  | 'fragment-resource-budget';
