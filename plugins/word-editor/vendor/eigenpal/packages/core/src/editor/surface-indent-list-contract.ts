// Indent and list contract types (paginated-surface seam).
//
// Split from `paginated-surface-contract.ts` the way the content-control and format painter
// lanes are: the indent buttons, Tab over a selection, the ruler's exact indents, the list
// buttons, and the keys that step out of a list or an indent. `PaginatedSurface` extends it,
// so a host reads these members on the surface as before.

/** Indent and list commands of the paginated surface. */
export interface SurfaceIndentAndListOps {
  /**
   * Word's Increase/Decrease Indent, over every paragraph the selection touches.
   *
   * A NUMBERED or BULLETED paragraph changes LEVEL: `w:numPr/w:ilvl` moves by one, which
   * re-resolves its marker from `numbering.xml` — so a bullet becomes a hollow circle, a
   * `1.` becomes an `a.`, exactly as Word demotes a list item. A level the definition
   * does not declare is DECLARED on the way, with Word's default format for that depth
   * (its stock bullets and number formats cycle every three levels) — a definition that
   * stops at `ilvl 0` never blocks the press. Everything else moves its `w:ind/@left` by
   * one default tab stop, never past the margin.
   *
   * Answers whether anything changed, so a caller can fall back (Tab inserting a tab
   * where there is no list to demote).
   */
  adjustIndent(direction: 'increase' | 'decrease'): boolean;
  /**
   * Tab (`increase`) or Shift+Tab (`decrease`) over a selection outside a list and outside a
   * table cell (the key moves between cells there): change the indent and keep the text.
   *
   * A selection over two or more paragraphs, or a cell rectangle (only from a host calling
   * this directly), steps the left indent of each paragraph. A selection in one paragraph that
   * starts at the paragraph start, whole or partial, works on the first line: Tab sets a first-line indent of one default tab stop
   * (`w:defaultTabStop`), or steps the left indent when the first line already has that
   * indent or more, or a hanging indent. Shift+Tab clears a first-line indent that the
   * paragraph states itself, so a style value applies again, and otherwise steps the left
   * indent back. A paragraph the selection reaches only at its start is not touched by this
   * rule, unless it is the empty last paragraph of the story.
   *
   * Answers true when the selection takes this rule, also when the write is refused or
   * changes nothing, so the text is never replaced. Answers false for a caret and for a
   * selection in one paragraph that starts inside the text; there Tab types a tab character
   * and Shift+Tab steps the left indent.
   */
  indentWithTab(direction: 'increase' | 'decrease'): boolean;
  /**
   * Set indent to exact values on every paragraph the selection touches — what a ruler
   * drag and an indent spinner both need, where {@link adjustIndent} only steps.
   *
   * Twips. Omitting a field leaves it as authored; `null` CLEARS it, so the paragraph
   * falls back to its style — distinct from zero, which blocks the cascade.
   *
   * `firstLine` is ONE SIGNED offset, negative for a hanging indent; the two OOXML
   * spellings are written for it, the unused one as an explicit zero. Answers whether
   * anything was committed.
   */
  setIndent(update: {
    readonly left?: number | null;
    readonly right?: number | null;
    readonly firstLine?: number | null;
  }): boolean;
  /**
   * Whether Increase/Decrease Indent would do anything right now.
   *
   * A list item at level 0 cannot outdent and one at level 8 cannot indent — `w:ilvl`
   * has nine levels and Word greys the control out at the ends. A missing level
   * DEFINITION never disables it: `adjustIndent` declares the level as it goes. The one
   * residue: a `w:numStyleLink` definition missing the level refuses the declaration
   * (its levels belong to the linked style), so there the press is a safe no-op rather
   * than a greyed control.
   */
  canAdjustIndent(direction: 'increase' | 'decrease'): boolean;
  /**
   * Enter on an empty list item: outdent a level, or leave the list at level 0. Backspace
   * at an item's start (`removeListNumber`): drop its number and keep the text in place.
   * Both answer false when they did not handle the key, so the caller splits or joins.
   */
  exitListOnEmptyItem(): boolean;
  /** Backspace at the start of `paragraphId`: drop its list number; false if it is not one. */
  removeListNumber(paragraphId: string): boolean;
  /**
   * Backspace at the start of an unnumbered `paragraphId`: remove its left and first-line or
   * hanging indent, or step it back to the marker of the list item it lines up with.
   *
   * False when the press should join instead: for a list item, an empty paragraph, a
   * paragraph in a content-locked control, and an indent this write cannot change (from a
   * table style, a level that paints no marker, or the earlier properties the Original view
   * shows). True when it wrote, and also when the write was refused, so the key is spent on
   * the refusal the surface publishes.
   */
  removeParagraphIndent(paragraphId: string): boolean;
  /** Whether the paragraph at the caret is a list item, for Tab's Word-like fallback. */
  isListParagraph(): boolean;
  /**
   * Word's Bullets and Numbering buttons.
   *
   * Turns every paragraph the selection touches into a list of `kind`, or takes them all
   * out when they are already one. The definition is created in `numbering.xml` on first
   * use — a document that has never carried a list has no numbering part at all.
   */
  toggleList(kind: 'bullet' | 'ordered'): boolean;
  /** Whether every paragraph the selection touches is already a list of `kind`. */
  isListActive(kind: 'bullet' | 'ordered'): boolean;
}
