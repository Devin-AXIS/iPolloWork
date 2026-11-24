/**
 * Header/footer and footnote/endnote public contract types for the Editor facade.
 *
 * Separated from `editor.ts` so the facade file stays under the max-lines gate while
 * furniture/notes APIs remain one cohesive vocabulary. Re-exported from `editor.ts`
 * so consumers keep importing `@docx-editor.dev/core/contracts/editor`.
 */

/** Furniture variant selected by section title-page / even-and-odd flags. */
export type FurnitureVariant = 'default' | 'first' | 'even';

/** Header/footer editing state: which region is being edited, if any. */
export interface HeaderFooterState {
  readonly editing: 'header' | 'footer' | null;
  readonly sectionIndex: number;
  /** Furniture variant in effect on the page used to enter the scope. */
  readonly variant?: FurnitureVariant;
  /** Relationship id of the open story (`EditorScope.rId`). */
  readonly rId?: string;
  /** Package part name of the open story. */
  readonly partName?: string;
  /**
   * Whether the resolved part is inherited from a preceding section ("Same as Previous")
   * rather than declared on this section.
   */
  readonly inherited?: boolean;
  /** Section `w:titlePg` — first-page furniture is distinct when true. */
  readonly titlePage?: boolean;
  /** Document `w:evenAndOddHeaders` — even-page furniture is distinct when true. */
  readonly evenAndOddHeaders?: boolean;
  /** Section header distance from sheet edge, twips (`w:pgMar w:header`). */
  readonly headerDistanceTwips?: number;
  /** Section footer distance from sheet edge, twips (`w:pgMar w:footer`). */
  readonly footerDistanceTwips?: number;
}

/** Footnote vs endnote — the public Editor vocabulary. */
export type NoteKind = 'footnote' | 'endnote';

/** Authored note-numbering fields as Word's properties dialog writes them. */
export interface AuthoredNoteNumbering {
  readonly pos?: string;
  readonly numFmt?: string;
  readonly numStart?: number;
  readonly numRestart?: string;
}

/**
 * Resolved note-numbering fields for one section. Numbering and the footnote position come
 * from the section's own properties and the defaults; the endnote position comes from the
 * document settings.
 */
export interface ResolvedNoteNumbering {
  readonly pos: string;
  readonly numFmt: string;
  readonly numStart: number;
  readonly numRestart: string;
}

/** One note kind's resolved + authored properties for the caret section. */
export interface NotePropertiesSide {
  readonly resolved: ResolvedNoteNumbering;
  /**
   * The document settings (settings.xml) values. Only the endnote `pos` affects `resolved`;
   * the other fields are kept for files that carry them.
   */
  readonly documentAuthored?: AuthoredNoteNumbering;
  /** The caret section's own values, which set numbering and the footnote position. */
  readonly sectionAuthored?: AuthoredNoteNumbering;
}

/** Resolved and authored note properties for the caret section — properties dialog read-model. */
export interface NotePropertiesState {
  readonly sectionIndex: number;
  readonly footnote: NotePropertiesSide;
  readonly endnote: NotePropertiesSide;
}

/** Optional slot targeting shared by remove / link / unlink furniture commands. */
export interface HeaderFooterSlotArgs {
  position?: 'header' | 'footer';
  /** Prefer over `firstPage` / `evenPage` when selecting a furniture variant. */
  variant?: FurnitureVariant;
  firstPage?: boolean;
  evenPage?: boolean;
  sectionIndex?: number;
}

/**
 * Header/footer lifecycle and page-field commands on {@link EditorCommands}.
 *
 * Kept as a mixin so `editor.ts` can extend it without inlining the furniture vocabulary.
 */
export interface EditorHeaderFooterCommands {
  /**
   * Open a header or footer for editing, materialising an empty one if the section has
   * none — which is what a double-click on the header band means in Word.
   *
   * Prefer `variant` when selecting first/even/default furniture. `firstPage` /
   * `evenPage` remain supported for existing callers (`firstPage: true` ≡ `variant:
   * 'first'`; `evenPage: true` ≡ `variant: 'even'`). Creating a missing `first` part
   * also enables section `w:titlePg` in the same undo unit; creating a missing `even`
   * part also enables document `w:evenAndOddHeaders` in the same undo unit.
   */
  editHeaderFooter: {
    position: 'header' | 'footer';
    variant?: FurnitureVariant;
    firstPage?: boolean;
    evenPage?: boolean;
    sectionIndex?: number;
  };

  /** Leave header/footer editing and return to the body. */
  exitHeaderFooter: Record<never, never>;

  /**
   * Delete a declared header/footer reference (and GC the part when orphaned). When the
   * editor is already in furniture scope, omitted fields default to the active story.
   */
  removeHeaderFooter: HeaderFooterSlotArgs;

  /**
   * Turn on "Same as Previous" for a section's furniture slot (drop its declared ref).
   * Refused on the first section. Omitted fields default to the active story when scoped.
   */
  linkHeaderFooterToPrevious: HeaderFooterSlotArgs;

  /**
   * Turn off "Same as Previous": clone the inherited part into a declared reference.
   * When the active scope was the inherited rId, the editor rebinds to the clone.
   */
  unlinkHeaderFooterFromPrevious: HeaderFooterSlotArgs;

  /**
   * Section/document furniture options: `titlePg` and header/footer distances on a
   * section; `evenAndOddHeaders` document-wide in settings.
   */
  setHeaderFooterOptions: {
    sectionIndex?: number;
    titlePage?: boolean;
    evenAndOddHeaders?: boolean;
    headerDistanceTwips?: number;
    footerDistanceTwips?: number;
  };

  /**
   * Insert an allowlisted page-number field at the caret. Only valid while a header or
   * footer scope is open. `PAGE_X_OF_Y` writes PAGE + " of " + NUMPAGES as one undo unit.
   */
  insertPageField: {
    field: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES' | 'PAGE_X_OF_Y';
  };
}

/**
 * Footnote/endnote lifecycle and properties commands on {@link EditorCommands}.
 */
export interface EditorNoteCommands {
  /** Insert a footnote or endnote reference at the caret (body only). */
  insertNote: {
    noteKind: NoteKind;
  };

  /** Delete a note and its body reference together. */
  deleteNote: {
    noteKind: NoteKind;
    noteId: number;
  };

  /** Convert one note to the other kind. */
  convertNote: {
    fromKind: NoteKind;
    noteId: number;
  };

  /** Convert every note of one kind to the other in document order (one undo step). */
  convertAllNotes: {
    fromKind: NoteKind;
  };

  /**
   * Footnote and endnote properties: numbering format, start value, restart rule and
   * position.
   *
   * - `scope: 'document'` (the default) writes every section and the document settings.
   * - `scope: 'section'` writes the `sectionIndex` section.
   * - The endnote `position` applies to the whole document, so it always goes to the document
   *   settings, in either scope, and never to a section.
   * - Fields you omit keep each section's value. A value equal to the default is not added
   *   where nothing authors the field, so applying the values a section already shows
   *   leaves the document unchanged.
   * - The write is not tracked in suggesting mode, like other section property writes.
   */
  setNoteProperties: {
    scope?: 'document' | 'section';
    sectionIndex?: number;
    footnote?: { numFmt?: string; numRestart?: string; position?: string; numStart?: number };
    endnote?: { numFmt?: string; numRestart?: string; position?: string; numStart?: number };
  };
}
