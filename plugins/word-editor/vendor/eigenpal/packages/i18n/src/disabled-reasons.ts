// Engine refusals → catalogue keys.
//
// An engine `disabledReason` is chrome a user reads, so it has to reach them in their own
// language. The engine states them in English because it has no locale, and this table is
// where that English becomes a key. A refusal with no entry here renders raw in every
// locale — which nothing else catches, so `disabled-reasons.test.ts` pins the ones that
// name a real limit rather than a diagnostic.

import type { TFunction, TranslationKey } from './index';

export const DISABLED_REASON_KEYS: Readonly<Record<string, TranslationKey>> = Object.freeze({
  'editor is not ready': 'disabledReason.editorNotReady',
  // Keyed on `LOCKED_FORMAT_REASON` in the engine's content-lock admission.
  'this content is locked': 'disabledReason.contentLocked',
  // Keyed on `LOCKED_PARAGRAPH_FORMAT_REASON` in the engine's
  // `paragraph-format-lock-refusal.ts`; the sentences must stay the same.
  'this content is locked; only alignment, indents, spacing, and line and page breaks can change':
    'disabledReason.lockedParagraphFormat',
  'not wired to an editor command': 'disabledReason.notWired',
  'this document was opened for viewing': 'disabledReason.viewing',
  'the document is open for viewing': 'disabledReason.viewing',
  // Keyed on `COMPARE_COLLABORATION_REASON` in the engine's `compare-documents-state.ts`; the
  // sentences must stay the same.
  'documents cannot be compared while a collaboration session is attached':
    'disabledReason.compareCollaboration',
  'this document permits editing only as tracked changes': 'disabledReason.trackedOnly',
  'no document is loaded': 'disabledReason.noDocument',
  'no document is open': 'disabledReason.noDocument',
  'the document has no review authors': 'disabledReason.noReviewAuthors',
  // Keyed on `SUGGESTING_AUTHOR_REASON` in the engine's opening-editing-mode lane; the two
  // must stay the same sentence or the Suggesting menu item explains itself in English only.
  'suggesting mode needs an author; configure author before enabling it':
    'disabledReason.suggestingNeedsAuthor',
  'no content control at the selection': 'disabledReason.noContentControl',
  // Keyed on `NO_COPIED_FORMATTING` in the engine's format-painter lane; the two must stay
  // the same sentence or the refusal reaches every locale in English.
  'no formatting has been copied': 'disabledReason.noCopiedFormatting',
  'there is nothing at the selection to copy': 'disabledReason.nothingToCopyFormatting',
  'the selection has nothing to paint': 'disabledReason.nothingToPaint',
  'no drawing is selected': 'disabledReason.noDrawing',
  // Keyed on `GROUP_MEMBER_REASON` and `GROUP_MEMBER_PROPERTIES_REASON` in the engine's
  // `group-member-selection.ts`; the sentences must stay the same.
  'a shape inside a group does not move, resize, or delete on its own; press Escape to select the group':
    'disabledReason.groupMemberMove',
  'a shape inside a group takes its wrap, alt text, and properties from the group; press Escape to select the group':
    'disabledReason.groupMemberProperties',
  'the drawing is locked': 'disabledReason.drawingLocked',
  'a comment needs a selected range': 'disabledReason.commentSelection',
  // Keyed on `NO_COMMENT_DRAFT_VIEW` in the engine's comment draft chrome.
  'no comment draft view is registered': 'disabledReason.noCommentDraftView',
  // Keyed on `NO_LINK_VIEW` in the engine's link chrome.
  'no link view is registered': 'disabledReason.noLinkView',
  'no Go To view is registered': 'disabledReason.noGoToView',
  'no bookmark dialog is registered': 'disabledReason.noBookmarkDialog',
  'nothing to undo': 'disabledReason.nothingToUndo',
  'nothing to redo': 'disabledReason.nothingToRedo',
  'the selection is already at the outermost level': 'disabledReason.outermostLevel',
  'the selection cannot indent any further': 'disabledReason.cannotIndentFurther',
  // Sentences earlier releases gave; hosts that override their keys keep working.
  // Earlier releases refused paragraph formatting inside a data-bound control with this one.
  'this content is bound to data and cannot change': 'disabledReason.boundParagraphFormat',
  'cell merge is not supported yet': 'disabledReason.mergeUnsupported',
  'cell split is not supported yet': 'disabledReason.splitUnsupported',
  // Keyed on the cell merge and split refusals in the engine's `table-cell-structure-plan.ts`
  // and `table-command-plan.ts`; the sentences must stay the same.
  'select two or more cells that form a rectangle to merge them':
    'disabledReason.mergeNeedsRectangle',
  'select two or more cells to merge them': 'disabledReason.mergeNeedsSelection',
  'select one cell to split it': 'disabledReason.splitNeedsOneCell',
  'a merged cell splits only into a number of rows that divides its rows':
    'disabledReason.splitRowsNotDivisor',
  'the cell is too narrow to split into that many columns': 'disabledReason.cellTooNarrow',
  'this table has no column grid, so the cell splits only into a divisor of its columns':
    'disabledReason.splitNeedsGrid',
  'the cells have a tracked change; accept or reject it first': 'disabledReason.cellHasRevision',
  'suggesting cannot merge or split cells; stop suggesting to change the table structure':
    'disabledReason.cellStructureSuggesting',
  // Keyed on `SUGGESTING_TABLE_DELETE_REFUSAL` and `SUGGESTING_TABLE_MOVE_REFUSAL` in the
  // engine's `surface-suggesting-structure.ts`; the sentences must stay the same.
  'suggesting cannot delete a whole table; stop suggesting to delete it, or delete its rows one at a time':
    'disabledReason.tableDeleteSuggesting',
  'suggesting cannot move a table; stop suggesting to move it':
    'disabledReason.tableMoveSuggesting',
  // Keyed on the `selectTableRegion` refusals in the engine's `table-select-plan.ts` and
  // `docx-editor-support.ts`, which name the region they refuse.
  'selecting a table row is not supported yet': 'disabledReason.selectTableRowUnsupported',
  'selecting a table column is not supported yet': 'disabledReason.selectTableColumnUnsupported',
  'this table uses a legacy horizontal merge the editor cannot change':
    'disabledReason.legacyMerge',
  'this table has a cell the editor cannot place in the grid':
    'disabledReason.tableGridUnplaceable',
  'image changes are not supported in suggesting mode': 'disabledReason.imageSuggesting',
  // Keyed on the equation lane's `can` refusals, which the equation popover shows.
  'compact linear editing cannot preserve this equation source formatting':
    'disabledReason.equationSourceFormatting',
  // Keyed on `NO_LINEAR_FORM_EQUATION_REFUSAL` in the engine's equation lane.
  'compact linear text cannot spell this equation': 'disabledReason.equationNoLinearForm',
  'equation replacement is not supported in suggesting mode': 'disabledReason.equationSuggesting',
  'in suggesting mode, remove the whole equation block rather than one equation':
    'disabledReason.equationSuggestingDisplay',
  // Keyed on `PICTURE_SELECTED_INSERT_REASON` in the engine's image lane.
  'a picture is selected; place the caret in text to insert a picture':
    'disabledReason.pictureSelected',
  'the drop target is stale; drop the image again': 'imageInsert.errors.staleTarget',
  'the drop target story is no longer active': 'imageInsert.errors.staleTarget',
  'the drop target is no longer attached': 'imageInsert.errors.staleTarget',
  // Keyed on `CHART_DRAWING_REASON` in the engine's image lane (`image-state-rules.ts`).
  'this drawing is a chart; only delete applies, and it removes the whole chart':
    'disabledReason.chartDrawing',
  // Keyed on `CHART_FRAME_REASON` in the engine's image lane (`image-state-rules.ts`).
  'this drawing is a chart; only its size, position, wrap and alt text change':
    'disabledReason.chartFrame',
  // Keyed on `DIAGRAM_FRAME_REASON` in the engine's image lane (`image-state-rules.ts`).
  'this drawing is a diagram; only its size, position, wrap and alt text change':
    'disabledReason.diagramFrame',
  // Keyed on `DIAGRAM_RESCALE_REFUSAL` in the engine's diagram lane (`tree-op-diagram-drawing.ts`).
  'this diagram cannot be resized: its saved drawing is shared or cannot scale to that size':
    'disabledReason.diagramRescale',
  // Keyed on `CHART_CLIPBOARD_REASON` in the engine's clipboard lane
  // (`clipboard-object-selection.ts`).
  'a chart can be copied, cut or pasted only on its own, not with other content':
    'disabledReason.chartClipboard',
  // Keyed on `CHART_CLIPBOARD_STALE_REASON` in the engine's chart clipboard
  // (`chart-clipboard.ts`).
  'the copied chart is no longer available; copy the chart again':
    'disabledReason.chartClipboardStale',
  'invalid table chrome value': 'disabledReason.invalidValue',
  'invalid value for toolbar command': 'disabledReason.invalidValue',
  'unsupported table command': 'disabledReason.unavailable',
  // Scope refusals. Each names a story limit the engine really enforces, so each is chrome the
  // user reads — and each rendered as raw English in every locale until it was listed here.
  'a section break can only be inserted in the editable document body':
    'disabledReason.bodyOnlySectionBreak',
  'a table of contents can only be inserted in the editable document body':
    'disabledReason.bodyOnlyToc',
  'insertNote requires body scope': 'disabledReason.bodyOnlyNote',
  'insertPageField requires an open header or footer scope':
    'disabledReason.furnitureOnlyPageField',
  // Not a scope refusal: the story is right and the MODE is not. A section break's type
  // lands on the section that follows it, and Word's record for that change is one this
  // engine refuses to accept or reject — so it cannot be proposed.
  'a section break that changes where the next section starts cannot be suggested; turn off suggesting to insert it':
    'disabledReason.suggestingSectionBreak',
  'a section break cannot be inserted inside a table cell': 'disabledReason.tableCellSectionBreak',
  // Deliberately NOT the store's `locked` / `bound` enums. Those are shared by every op —
  // `locked` covers a locked CONTROL whose content is editable as well as locked content —
  // so one sentence cannot be true of all of them. Each lane says what its own refusal means.
  'a section break cannot change a section that a locked or linked content control holds':
    'disabledReason.lockedSectionBreak',
  'a section break cannot be inserted in locked or linked content':
    'disabledReason.lockedContentBreak',
  // Keyed on the bulk review refusals in the engine's `docx-editor-review-commands.ts`; the
  // sentences must stay the same.
  'no eligible selected changes to review': 'disabledReason.noReviewChanges',
  'these changes would also resolve changes the filter hides; clear the filter to review them first':
    'disabledReason.reviewHiddenChanges',
  'these changes would also resolve changes the selection leaves out; decide each card':
    'disabledReason.reviewOtherChanges',
  'none of the selected changes can be resolved': 'disabledReason.reviewUnresolvable',
  'some selected changes cannot be resolved': 'disabledReason.reviewSomeUnresolvable',
  'content controls lock every remaining change; remove the locks to decide them':
    'disabledReason.reviewLockedChanges',
  'every remaining change is in a data-bound content control': 'disabledReason.reviewBoundChanges',
  // Keyed on the refusals of the engine's `shape-format-commands.ts`; the sentences must stay
  // the same.
  'this drawing has no fill or outline to set': 'shape.errors.noShape',
  'the shape has no solid fill to change; set a color': 'shape.errors.noSolidFill',
  'the shapes in this group have different fills; pick a color to set them all':
    'shape.errors.mixedFill',
  'a legacy shape has no transparency': 'shape.errors.legacyTransparency',
  'the fill or outline value is out of range': 'shape.errors.outOfRange',
  'stale drawing selection': 'shape.errors.staleSelection',
  // Keyed on `CHART_SUGGESTING_REFUSAL` in the engine's `surface-chart-ops.ts`.
  'chart changes are not supported in suggesting mode': 'chart.errors.suggesting',
});

/**
 * Translate a known engine refusal for adapter chrome.
 *
 * Unknown diagnostics stay exact, so integrations never lose the engine's explanation.
 *
 * @public
 */
export function localizeDisabledReason(reason: string | null, t: TFunction): string | null {
  if (!reason) return null;
  // `Object.hasOwn`, because this is a @public entry point and a plain object answers
  // `constructor` and `toString` from its prototype — truthy values that are not keys.
  const key = Object.prototype.hasOwnProperty.call(DISABLED_REASON_KEYS, reason)
    ? DISABLED_REASON_KEYS[reason]
    : undefined;
  if (key) return t(key);
  // The chart lane and the Format shape pane state their refusals as `chart.errors.*` and
  // `shape.pane.errors.*` keys, which name themselves.
  return /^(chart\.errors|shape\.pane\.errors)\.[a-zA-Z]+$/.test(reason)
    ? t(reason as TranslationKey)
    : reason;
}
