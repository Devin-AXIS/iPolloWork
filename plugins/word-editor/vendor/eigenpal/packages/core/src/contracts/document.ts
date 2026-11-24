/**
 * `@docx-editor.dev/core/contracts/document` — the document-level edit and query vocabulary.
 *
 * The subset that means something without a live editor: what an automation host or an LLM tool
 * can ask for and change.
 *
 * A CONTRACT module, not a barrel. `contracts/editor` builds the `Editor` command and query
 * surfaces on top of these, so they cannot live in the package root: the root re-exports
 * runtime from `../editor`, and a contract importing the root would invert the dependency —
 * safe today only because that import is type-only, and one accidental value import away from
 * pulling the painted engine into a server bundle.
 *
 * @packageDocumentation
 * @public
 */

import type {
  ContainerRef,
  ContentControlFilter,
  ContentControlType,
  DocComment,
  DocRange,
  InsertableContentControlType,
  Revision,
  StyleDefinitions,
  DocTarget,
  DocxDocument,
  ExecResult,
  Extent,
  RunFormatting,
} from './types';
// Declared in the store lane; `types.ts` re-exports them for the contract.
export type {
  ReviewPosition,
  ReviewRange,
  ReviewRevisionItem,
  ReviewRevisionKind,
  RevisionAddress,
  RevisionAuthorEntry,
  RevisionAuthorSkipReason,
  RevisionBatchEntry,
  RevisionBatchSkipDetail,
  RevisionBatchSkipReason,
  RevisionSiteRefusal,
} from './types';

// Re-exported because the signatures below hand every one of them to a caller. This entry
// point is meant to be usable on its own — an automation host or a tool layer names it
// without touching the editor contract — so a name it returns and does not export is a
// result the caller cannot type.
export type {
  Block,
  ColorValue,
  CompareDocumentsOutcome,
  ReplaceDocumentOutcome,
  ReplaceDocumentRefusal,
  CompareDocumentsEngineErrorCode,
  CompareDocumentsErrorCode,
  CompareDocumentsRefusalReason,
  ContainerRef,
  ContentControl,
  ContentControlFilter,
  ContentControlType,
  DocAnchor,
  DocAnchorRange,
  DocComment,
  DocLocation,
  DocRange,
  DocTarget,
  DocumentBody,
  DocxDocument,
  ExecErrorCode,
  ExecResult,
  Extent,
  HeaderFooterSet,
  HistoryGroupOutcome,
  IndentFormatting,
  InsertableContentControlType,
  NumberingRef,
  PageMargins,
  Paragraph,
  ParagraphDisagreements,
  ParagraphFlags,
  ParagraphTabStop,
  ReplaceAllMatchesOutcome,
  Revision,
  RevisionAuthorResult,
  RevisionBatchResult,
  RevisionType,
  Run,
  RunFormatting,
  Section,
  SectionProperties,
  StyleDefinition,
  StyleDefinitions,
  Table,
  TableCell,
  TableRow,
  Theme,
  ThemeColorScheme,
} from './types';

// ─── Edits ───────────────────────────────────────────────────────────────────

/**
 * The document-executable edit vocabulary.
 *
 * An interface rather than a closed union so extensions can widen it by
 * declaration merging. A sealed union cannot be extended by a plugin, and the
 * runtime dispatch is already registry-backed.
 */
export interface DocEdits {
  insertText: { target: DocTarget; text: string };
  /**
   * Replace the selection with `text`, as a paste does: newlines start paragraphs, and an
   * empty `text` deletes the selection. Tracked in suggesting mode. The editor acts on the
   * selection and refuses a `target`.
   */
  replaceText: { target: DocTarget; text: string };
  deleteText: { target: DocTarget };
  /**
   * Set run formatting over the selection in one undo step: every mark applies, or none does.
   * Accepts the run fields of {@link RunFormatting}: `bold`, `italic`, `underline`, `strike`,
   * `superscript`, `subscript`, a hex `color`, `highlight`, `fontFamily`, and `fontSizePt`.
   * `false` states a switch off. A paragraph field, a theme color, or both scripts together
   * are refused with `invalidArgs`. The editor acts on the selection and refuses a `target`.
   */
  applyFormatting: { target: DocTarget; marks: RunFormatting };
  setParagraphStyle: { target: DocTarget; styleId: string };
  insertTable: { target: DocTarget; rows: number; cols: number };
  insertImage: { target: DocTarget; data: Uint8Array; extent?: Extent };
  insertHyperlink: { target: DocTarget; href: string; text?: string };
  removeHyperlink: { target: DocTarget };
  /**
   * `'section'` is Word's Next Page break; `'sectionContinuous'` keeps the new section on
   * the sheet the previous one ended, which is how a mid-page column or margin change is
   * authored. `'column'` belongs to the multi-column lane and is refused for now.
   */
  insertBreak: {
    target: DocTarget;
    kind: 'page' | 'column' | 'line' | 'section' | 'sectionContinuous';
  };
  /**
   * Word's Increase/Decrease Indent.
   *
   * A numbered or bulleted paragraph changes LEVEL, so its marker re-resolves from the
   * numbering definition — a bullet becomes a hollow circle, a `1.` becomes an `a.`.
   * Every other paragraph moves its left indent by one default tab stop.
   */
  adjustIndent: { target: DocTarget; direction: 'increase' | 'decrease' };
  /**
   * Word's Bullets and Numbering.
   *
   * Turns the selection into a list, or takes it out of one when it already is. The
   * definition is created on first use, `numbering.xml` included.
   */
  toggleList: { target: DocTarget; kind: 'bullet' | 'ordered' };
  /** Split the paragraph at the selection, as Enter does. Tracked in suggesting mode. */
  splitParagraph: { target: DocTarget };
  /**
   * Join the paragraphs the selection spans, or the selection's paragraph and the next one in
   * its story. Suggesting mode proposes removing the paragraph marks instead. A join across
   * table cells is refused; with no following paragraph the result is `notFound`.
   */
  mergeParagraphs: { target: DocTarget };
  /**
   * Set a document variable (`w:docVars`). Not implemented by the editor: refused with
   * `unsupported`.
   */
  setVariable: { name: string; value: string };
  /** Set several document variables. Not implemented by the editor: refused with `unsupported`. */
  applyVariables: { values: Record<string, string> };

  /**
   * Authored family. `author` is required: tracked-ness is verb identity, not a
   * boolean flag, so there is no global trackChanges toggle to forget.
   */
  proposeReplacement: { target: DocTarget; replaceWith: string; author: string };
  proposeInsertion: { target: DocTarget; text: string; author: string };
  proposeDeletion: { target: DocTarget; author: string };
  /**
   * Comment on the selection. In the editor this runs `Editor.addComment` with the same gates
   * and history group support; `author` overrides the configured author for one call. The
   * editor does not take a `target`: a command with one is refused with `unsupported`.
   * Requires the review module, as every comment and revision command does.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/pro/tracked-changes#comment-and-decide-by-id | Comment and decide by id}
   */
  addComment: { target: DocTarget; text: string; author: string };
  /**
   * Reply to the comment whose `w:id` is `commentId`, the `id` of a `DocComment` and of
   * `ReviewCommentItem.comment`. In the editor this runs `Editor.replyToReviewItem` on that
   * comment's card. An unknown id, or a comment that a reviewer filter hides, is refused
   * with `notFound`.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/pro/tracked-changes#comment-and-decide-by-id | Comment and decide by id}
   */
  replyComment: { commentId: string; text: string; author: string };
  /**
   * Resolve the comment thread whose `w:id` is `commentId`. In the editor this runs
   * `Editor.setCommentResolved` on that comment's card, with the same rules as
   * `replyComment`. Resolving a resolved thread succeeds with `changed: false`.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/pro/tracked-changes#comment-and-decide-by-id | Comment and decide by id}
   */
  resolveComment: { commentId: string };

  /**
   * Accept the tracked change whose `w:id` is `id`. `@w:id` is unique only within a part, so
   * `part` names it: `'body'` (the default) is the main document, and `'footnote'` and
   * `'endnote'` are the notes parts. `noteId` narrows a note change to the note with that
   * `w:id`. In the editor this runs `Editor.acceptReviewItem` on the change's card, so it
   * resolves every site of that change in one undo step and joins a history group.
   *
   * Refused with `notFound` when no listed change has the id there (a reviewer filter hides
   * changes), with `invalidArgs` when the id names more than one change (decide each with
   * `acceptReviewItem`), and with `locked` under tracked-changes protection.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/pro/tracked-changes#comment-and-decide-by-id | Comment and decide by id}
   */
  acceptRevision: { id: number; part?: 'body' | 'footnote' | 'endnote'; noteId?: number };
  /**
   * Reject the tracked change whose `w:id` is `id`. Addressing, gates, and refusals are the
   * same as for `acceptRevision`; the editor runs `Editor.rejectReviewItem`.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/pro/tracked-changes#comment-and-decide-by-id | Comment and decide by id}
   */
  rejectRevision: { id: number; part?: 'body' | 'footnote' | 'endnote'; noteId?: number };
  /**
   * Accept every tracked change in the document in one undo step: the body, tables,
   * headers, footers, notes, and text boxes. Reviewer filters do not narrow it. In the editor
   * it runs as `resolveAllReviewChanges` with `scope: 'document'` and returns the same
   * `revisions` result. A change that cannot be accepted, such as one in locked content, is
   * left pending and listed in `revisions.skipped`.
   *
   * Requires the review module from `@docx-editor.dev/pro`; without it the command is refused
   * with `unsupported`. Also refused with `locked` while viewing or under read-only, comments,
   * or tracked-changes protection, with `notFound` when the document has no tracked
   * changes, and, when no change can be accepted, with `locked`, `bound`, or `unsupported`
   * for the cause. A refusal writes nothing.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/pro/tracked-changes#accept-or-reject-every-change | Accept or reject every change}
   */
  acceptAllRevisions: Record<never, never>;
  /**
   * Reject every tracked change in the document in one undo step. The scope, gates, and
   * result are the same as for `acceptAllRevisions`.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/pro/tracked-changes#accept-or-reject-every-change | Accept or reject every change}
   */
  rejectAllRevisions: Record<never, never>;

  /**
   * Author a NEW control over the addressed span.
   *
   * A RANGE becomes a wrapper around the characters that are already there. A COLLAPSED
   * position inserts an empty control showing its type's prompt, which is Word's own gesture
   * and the one a template host reaches for: the first character typed replaces the prompt
   * whole, so nothing has to detect and undo text the caller never asked for.
   *
   * `title` is Word's `w:alias` — the label a user sees — and `tag` is `w:tag`, the
   * machine-readable identity a host looks the control back up by. Named as the automation
   * protocol names them, so a caller who reaches for both surfaces writes one vocabulary.
   *
   * One paragraph only. A control that starts in one paragraph and ends in another is a BLOCK
   * wrapper over both, a different element than the inline one this authors — refused rather
   * than guessed, so a caller learns which they asked for.
   */
  insertContentControl: {
    target: DocTarget;
    subtype: InsertableContentControlType;
    tag?: string;
    title?: string;
  };
  setContentControlValue: { target: DocTarget; value: string };
  removeContentControl: { target: DocTarget };
  addRepeatingSectionItem: { target: DocTarget; index?: number };
  removeRepeatingSectionItem: { target: DocTarget; index: number };
}

/**
 * One edit, as a discriminated union derived from {@link DocEdits}.
 *
 * Adding a key to `DocEdits` — including by declaration merging from a plugin — widens this
 * automatically, so the union never drifts from the vocabulary it is built out of.
 */
export type DocEdit = { [K in keyof DocEdits]: { type: K } & DocEdits[K] }[keyof DocEdits];

/**
 * What applying a batch of edits produced: the new document, and a per-edit verdict.
 *
 * `results` is positionally aligned with the input, so an edit that failed is identified by its
 * index rather than by anything the caller has to correlate.
 */
export interface ApplyResult {
  doc: DocxDocument;
  /** One per edit, positionally aligned with the input. */
  results: ExecResult[];
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * The document-readable query vocabulary, keyed identically to {@link DocQueryResults}.
 *
 * An interface rather than a closed union for the same reason {@link DocEdits} is: an extension
 * widens it by declaration merging, and the runtime dispatch is registry-backed.
 */
export interface DocQueries {
  paragraphs: { container?: ContainerRef };
  findText: { text: string; container?: ContainerRef };
  contentControls: { filter?: ContentControlFilter };
  revisions: { part?: 'body' | 'footnote' | 'endnote' };
  comments: { resolved?: boolean };
  styles: Record<never, never>;
  variables: Record<never, never>;
}

/** One query, as a discriminated union derived from {@link DocQueries}. */
export type DocQuery = { [K in keyof DocQueries]: { type: K } & DocQueries[K] }[keyof DocQueries];

/** What each query returns. Keyed identically to `DocQueries`. */
export interface DocQueryResults {
  paragraphs: readonly ParagraphSummary[];
  findText: readonly DocRange[];
  contentControls: readonly ContentControlSummary[];
  revisions: readonly Revision[];
  comments: readonly DocComment[];
  styles: StyleDefinitions;
  variables: Readonly<Record<string, string>>;
}

/**
 * A paragraph reduced to what a listing needs: its stable handle, its text, and its style.
 *
 * `paraId` is what a follow-up edit addresses, so a summary without one names a paragraph the
 * file gave no `w14:paraId` and that a `DocAnchor` cannot reach.
 */
export interface ParagraphSummary {
  readonly paraId?: string;
  readonly text: string;
  readonly styleId?: string;
}

/** A content control reduced to what a listing needs: its identity, kind, and lock state. */
export interface ContentControlSummary {
  readonly id: string;
  readonly tag?: string;
  readonly alias?: string;
  readonly controlType: ContentControlType;
  readonly locked?: boolean;
}
