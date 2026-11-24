import { insertsBeforePrompt } from './tree-op-prompt-bias.ts';
import { withDisplayedHyphens } from '../package/hyphen-text.ts';
import { withTailStyle } from './tree-op-paragraph-tail.ts';
import { withInsertionHints } from './tree-op-text-splice-hints.ts';
import { applySetFieldCode } from './tree-op-field-code.ts';
import { applyTableAuthoring } from './tree-op-table-batch.ts';
import { applyTableProperties } from './tree-op-table-authoring.ts';
import {
  checkboxContent,
  decodeCheckboxGlyph,
  isInlineControl,
} from './content-control-checkbox.ts';
import { valueContent, withParagraphDiff } from './content-control-value-content.ts';
import { applyFieldResultOp, isFieldResultOp } from './tree-op-field-results.ts';
import { removeCoveredTextFormDefinitions } from './text-form-field-deletion.ts';
// Op application over the canonical tree (tree-ops seam).
//
// This module owns turning a VALIDATED op into a new part plus its structural effect.
// Application is pure: `applyTreeOp` never mutates its input, and it validates first via
// tree-op-validate.ts so a rejected op is a true no-op. Vocabulary, segmentation, and
// validation live in sibling tree-op-* modules; tree-ops.ts re-exports the public surface.
/* eslint-disable max-lines -- pre-existing size; furniture lifecycle only adds union narrowing */

import {
  simpleElement,
  textElement,
  textWithHyphenBuilders,
  textWithHyphens,
} from './tree-op-inline-elements.ts';
import { characterStyleElement, emptyParagraphRunProperties } from './mark-character-style-run.ts';
import { contains, runElement, splitRunsAt, textKindOfValue } from './tree-op-split-runs.ts';
import {
  insertAfterNoteInRun,
  noteReferenceEndingAt,
  noteTypingProperties,
} from './note-typing-boundary.ts';
import { withFreshIds } from '../package/hf-lifecycle-shell.ts';
import { endsFitTextGroup, insertAfterFitTextGroup } from './fit-text-typing-boundary.ts';
import {
  isContentRevisionKind,
  isInlineRunContainer,
  MAX_INLINE_CONTAINER_DEPTH,
  W14_NAMESPACE_URI,
} from '../package/ooxml-shared.ts';
import { linearMathReplacementOmml } from '../package/omml-equation.ts';
import { equationsOfAtom, isOmmlDisplay } from '../package/omml-display.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  applyEdits,
  createNodeIdAllocator,
  findNode,
  insertChildren,
  removeNode,
  replaceChildren,
  replaceNode,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { wmlFreshNamespaceContextAt } from '../package/wml-namespace.ts';
import {
  carryEmptyContentControlsAcrossRunPropertyEdit,
  contentControlLevelOf,
} from '../package/content-control-nodes.ts';
import { resolveRevisionOperation } from './tree-op-revisions.ts';
import { applySetRevisionAttribution } from './revision-author-change.ts';
import { applyInsertCommentMarker } from './tree-op-comments.ts';
import { applyDeleteTracked } from './tree-op-tracked-delete.ts';
import {
  applyInsertTracked,
  applyInsertTrackedElement,
  applyInsertTrackedElements,
  insertedRunProperties,
} from './tree-op-tracked.ts';
import { splicedJoined } from './revision-piece-seams.ts';
import {
  applyParagraphMarkRevision,
  applyProposeParagraphMerge,
  retractsOwnParagraphMark,
} from './tree-op-tracked-marks.ts';
import {
  insideOwnInsertion,
  ownProposedParagraph,
  withPropertyChangeRecord,
} from './tree-op-tracked-properties.ts';
import { nextRevisionId } from './tree-op-revision-ids.ts';
import { build, revisionAttributes } from './tree-op-tracked-builders.ts';
import {
  isValidParaId,
  mintParaId,
  mintedParagraphIdentityAttributes,
  paraIdOf,
  usedParaIds,
  w14PrefixInScopeAt,
  fnv1a32,
} from '../package/para-id.ts';
import { actorScopedSeed } from '../package/actor-scoped-ids.ts';
import {
  TEXT_DEPS,
  attributeValueOf,
  checkboxPayloadOf,
  cloneWithNewIds,
  contentControlContentOf,
  contentControlPropertiesOf,
  contentControlUnwrapPayload,
  contentControlValueTypeOf,
  findContentControl,
  formatSdtDateDisplay,
  fromEdit,
  innermostContentControlAround,
  isContentControlNode,
  isParagraphMarkRevision,
  isParagraphPropertiesNode,
  isRunPropertiesNode,
  isShowingPlaceholder,
  isTemporaryControl,
  listItemsOf,
  leavesInlineContainer,
  namedChild,
  normalizeSdtFullDate,
  ok,
  paragraphPropertiesNodeOf,
  parentOf,
  parseCheckboxValue,
  runPropertiesNodeOf,
  sdtPrChild,
} from './tree-op-nodes.ts';
import { caretAfterBlockRemoval, paragraphIdsWithin } from './tree-op-blocks.ts';
import { tableAncestorOf } from './tree-op-table-shared.ts';
import {
  planVerticalMergeHeadRepairs,
  verticalMergeHeadRepairDirtyIds,
  rowRemovalEdits,
} from './tree-op-table-vmerge-removal.ts';
import {
  PARAGRAPH_VOCABULARY,
  RUN_VOCABULARY,
  mergedPropertyChildren,
} from './tree-op-properties.ts';
import {
  applySetListLevel,
  applySetParagraphMarkProperties,
  applySetListNumbering,
  applySetParagraphTabStops,
  applySetSectionMark,
  applySetSectionProperties,
} from './tree-op-section.ts';
import { applySetParagraphBorders } from './tree-op-paragraph-borders.ts';
import { pageFieldContentBuilders, pageFieldModelLength } from './tree-op-fields.ts';
import { applyInsertComplexField } from './tree-op-field-insert.ts';
import { applySetFieldResult } from './tree-op-field-result-write.ts';
import { withoutOriginalMark } from './tree-op-split-mark.ts';
import { applyInsertEquation } from './tree-op-equation-insert.ts';
import { applyTrackedContentControl } from './tracked-content-control-insert.ts';
import {
  applyContentControlValueOp,
  trackedTextAtControlEdge,
} from './tracked-content-control-value.ts';
import { applyInsertContentControl as applyAutomationInsertContentControl } from './tree-op-content-control-insert.ts';
import {
  applyRemoveContentControl as applyAutomationRemoveContentControl,
  applySetContentControlProperties as applyAutomationSetContentControlProperties,
  clearPlaceholder,
  placeholderControlForInsertion,
} from './tree-op-content-controls.ts';
import {
  carrySegmentsAcrossRunPropertyEdit,
  insertionDestination,
  fieldInsertionEndAt,
  paragraphOffsetIndex,
  runsUnder,
  segmentAncestryNodeId,
  segmentsOf,
  type Segment,
} from './tree-op-segments.ts';
import { formattingRunBesideRestrictedControl } from './tree-op-restricted-edge.ts';
import {
  applyInsertToc,
  applyReplaceTocResult,
  applyRewriteTocPageNumbers,
} from './tree-op-toc.ts';
import { applyRemoveToc } from './tree-op-toc-remove.ts';
import { applyInsertTable } from './tree-op-insert-table.ts';
import { applyMoveTable } from './tree-op-move-table.ts';
import { applyInsertParagraphBesideTable } from './tree-op-paragraph-beside-table.ts';
import { applyReplaceStoryBlocks } from './tree-op-story-replace.ts';
import {
  inlineWrapperProperties,
  wrapperChildren,
  fieldSplitChildren,
} from './tree-op-inline-wrapper-split.ts';
import type {
  OoxmlProperty,
  RevisionAttributionInput,
  TreeDocOp,
  TreeOpEffect,
  TreeOpResult,
} from './tree-op-types.ts';
import {
  applyTableRowOp,
  applyTableColumnOp,
  applyTableResizeOp,
  applyTableCellPropertyOp,
} from './tree-op-tables.ts';
import { applyMergeTableCells } from './tree-op-table-merge.ts';
import { applySplitTableCell } from './tree-op-table-split.ts';
import { addressesMergedColumns, applyMergedColumnOp } from './tree-op-table-merged-columns.ts';
import { contentControlAtCaret, validateTreeOp } from './tree-op-validate.ts';
import { isDrawingTreeDocOp } from './tree-op-drawings.ts';
import { applyInsertFragment } from './tree-op-fragment.ts';
import { applyDrawingContentEdit } from './drawing-content-edit.ts';
import { applyInsertBuildingBlock } from './building-block-insert.ts';
import { applyBookmarkOp, isBookmarkTreeOp, withBookmarkEditRules } from './tree-op-bookmarks.ts';
import { healedTableProperties, tableIdOf } from './tree-op-table-heal.ts';
import { closesAnOpenRange, opensARange, zeroLengthGoesToHead } from './tree-op-split-markers.ts';
import {
  promptInsertionOffset,
  restoreEmptiedPlaceholder,
} from './content-control-prompt-restore.ts';

/** The one run-level element each insert op places, shared by its tracked and untracked arms. */
const RUN_ELEMENT_INSERTS: Readonly<
  Record<'insertTab' | 'insertHardBreak' | 'insertPageBreak', (nextId: () => string) => OoxmlNode>
> = {
  insertTab: (nextId) => simpleElement(nextId, 'tab'),
  insertHardBreak: (nextId) => simpleElement(nextId, 'br', 'line'),
  insertPageBreak: (nextId) => simpleElement(nextId, 'br', 'page'),
};

/**
 * Apply one validated op to a part.
 *
 * Validation runs first and returns before any tree work, so a rejected op is a true no-op:
 * the caller keeps the part it passed in, unchanged and still frozen.
 *
 * `options.deferValidation` passes through to the edit primitives: a transaction applying
 * many ops re-validates the whole part once at its commit boundary rather than after every
 * primitive, which is the difference between a paste that is linear and one that is
 * quadratic in document size.
 */
export function applyTreeOp(part: OoxmlPart, op: TreeDocOp, options?: EditOptions): TreeOpResult {
  // A table edit first merges the property containers a concurrent merge repeated.
  const tableId = tableIdOf(op);
  if (tableId !== null) {
    const healed = healedTableProperties(part, tableId, options);
    if (healed === null) return { ok: false, reason: 'tree-invariant' };
    part = healed;
  }
  const run = () =>
    withBookmarkEditRules(part, op, options, () => applyValidatedTreeOp(part, op, options));
  return op.op === 'insertText' ? withInsertionHints(part, op.paragraphId, op.offset, run) : run();
}

function applyValidatedTreeOp(part: OoxmlPart, op: TreeDocOp, options?: EditOptions): TreeOpResult {
  const rejection = validateTreeOp(part, op, options);
  if (rejection) return { ok: false, reason: rejection };

  if (op.op === 'replaceStoryBlocks') {
    return applyReplaceStoryBlocks(part, op.storyRootId, op.paragraphs, options);
  }
  if (op.op === 'setContentControlValue')
    return applyContentControlValueOp(part, op, options, applySetContentControlValue);
  if (op.op === 'setContentControlProperties') {
    return applyAutomationSetContentControlProperties(part, op, options);
  }
  if (op.op === 'removeContentControl' && op.keepContent !== undefined) {
    return applyAutomationRemoveContentControl(part, op, options);
  }
  if (op.op === 'insertContentControl') {
    return op.revision
      ? applyTrackedContentControl(part, op, options)
      : applyAutomationInsertContentControl(part, op, options);
  }
  // Typing into a prompt REPLACES it. The transition belongs here rather than beside the
  // caret: an automation call and a paste insert text too, and a prompt that survived them
  // would leave the typed characters appended to "Click here to enter text.".
  if (op.op === 'insertText' && !op.revision) {
    const prompt = placeholderControlForInsertion(part, op.paragraphId, op.offset);
    const paragraph = findNode(part, op.paragraphId);
    const before =
      prompt &&
      paragraph?.kind === 'paragraph' &&
      op.inside === undefined &&
      insertsBeforePrompt(paragraph, op.offset, prompt.control, op.bias);
    if (prompt && !before) {
      // The caret's paragraph is the one the prompt is emptied into, so the insert below
      // still finds it. A prompt whose content cannot be emptied in place is refused, not
      // flattened by the insertion path: that path would replace the wrapped cell too.
      const emptied = clearPlaceholder(part, prompt.control.id, options, op.paragraphId);
      if (!emptied) return { ok: false, reason: 'unsupported' };
      const result = applyTreeOp(
        emptied,
        {
          ...op,
          offset: promptInsertionOffset(emptied, op.paragraphId, prompt.offset),
          inside: prompt.control.id,
        },
        options
      );
      // Emptying the prompt may drop its other paragraphs; the insert's effect must say so.
      const cleared = findNode(emptied, prompt.control.id);
      if (!result.ok || !cleared) return result;
      return { ...result, effect: withParagraphDiff(result.effect, prompt.control, cleared) };
    }
  }

  if (op.op === 'authorTable') return applyTableAuthoring(part, op);
  if (op.op === 'setTableProperties') return applyTableProperties(part, op, options);
  if (op.op === 'insertTableRow' || op.op === 'deleteTableRow')
    return applyTableRowOp(part, op, options);
  if (op.op === 'insertTableColumn' || op.op === 'deleteTableColumn') {
    if (addressesMergedColumns(part, op)) return applyMergedColumnOp(part, op, options);
    return applyTableColumnOp(part, op, options);
  }
  if (op.op === 'mergeTableCells') return applyMergeTableCells(part, op, options);
  if (op.op === 'splitTableCell') return applySplitTableCell(part, op, options);
  if (
    op.op === 'setTableColumnWidths' ||
    op.op === 'setTableRightEdgeWidth' ||
    op.op === 'setTableRowHeight'
  ) {
    return applyTableResizeOp(part, op, options);
  }
  if (
    op.op === 'setTableCellBorders' ||
    op.op === 'setTableCellFill' ||
    op.op === 'setTableCellVerticalAlignment'
  ) {
    return applyTableCellPropertyOp(part, op, options);
  }
  if (isDrawingTreeDocOp(op)) return applyDrawingContentEdit(part, op, options);
  if (op.op === 'insertFragment') return applyInsertFragment(part, op, options);
  if (op.op === 'insertBuildingBlock') return applyInsertBuildingBlock(part, op, options);
  if (isBookmarkTreeOp(op)) return applyBookmarkOp(part, op, options);
  if (op.op === 'insertTable') return applyInsertTable(part, op, options);
  if (op.op === 'moveTable') return applyMoveTable(part, op, options);
  if (op.op === 'insertParagraphBesideTable')
    return applyInsertParagraphBesideTable(part, op, options, applyTreeOp);
  if (op.op === 'deleteBlock') return applyDeleteBlock(part, op.blockId, options);
  if (op.op === 'insertToc') return applyInsertToc(part, op, options);
  if (op.op === 'replaceTocResult') return applyReplaceTocResult(part, op, options);
  if (op.op === 'removeToc') return applyRemoveToc(part, op, options);
  if (op.op === 'rewriteTocPageNumbers') return applyRewriteTocPageNumbers(part, op, options);
  if (isFieldResultOp(op)) return applyFieldResultOp(part, op, options);
  if (op.op === 'setFieldCode') return applySetFieldCode(part, op, options);
  if (op.op === 'setFieldResult') return applySetFieldResult(part, op, options);
  if (op.op === 'insertEquation') return applyInsertEquation(part, op, options);
  if (op.op === 'joinParagraphs') return applyJoin(part, op.firstId, op.secondId, options);
  if ((op.op === 'setHyperlinkTarget' || op.op === 'removeHyperlink') && op.range) {
    return applyPartialHyperlink(part, op, options);
  }
  if (op.op === 'setHyperlinkTarget') return applySetHyperlinkTarget(part, op, options);
  if (op.op === 'removeHyperlink') return applyRemoveHyperlink(part, op.linkId, options);
  if (op.op === 'setMathEquation' || op.op === 'removeMathEquation') {
    const equation = findNode(part, op.equationId);
    if (!equation || equation.kind === 'textValue') {
      return { ok: false, reason: 'tree-invariant' };
    }
    let ancestor: OoxmlNode | null = equation;
    let paragraph: OoxmlParagraphNode | null = null;
    while (ancestor) {
      if (ancestor.kind === 'paragraph') {
        paragraph = ancestor;
        break;
      }
      ancestor = parentOf(part, ancestor.id);
    }
    if (!paragraph) return { ok: false, reason: 'tree-invariant' };
    const effect: TreeOpEffect = {
      dirty: [paragraph.id],
      created: [],
      deleted: [],
      dependencyKeys: TEXT_DEPS,
      impact: 'text-local',
    };
    if (op.op === 'removeMathEquation') {
      // The last equation of a display takes its `m:oMathPara` with it: an empty display
      // is invalid OMML and would leave an invisible atom in the paragraph.
      const display = parentOf(part, equation.id);
      const target =
        display && isOmmlDisplay(display) && equationsOfAtom(display).length === 1
          ? display.id
          : equation.id;
      return fromEdit(removeNode(part, target, options), effect);
    }
    // Default control properties of the replaced equation carry over to each new structure.
    const generated = linearMathReplacementOmml(op.linear, createNodeIdAllocator(part), equation);
    if (!generated.ok) return { ok: false, reason: 'invalid-property-value' };
    // Retain the equation identity. An open popover and an undo record both address the
    // complete math atom, while every internal OMML node receives a fresh part-scoped id.
    const replacement = { ...generated.equation, id: equation.id };
    return fromEdit(replaceNode(part, equation.id, replacement, options), effect);
  }
  if (op.op === 'insertCommentMarker') {
    const paragraph = findNode(part, op.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph')
      return { ok: false, reason: 'not-a-paragraph' };
    return applyInsertCommentMarker(part, paragraph, op, options);
  }
  if (
    op.op === 'acceptRevision' ||
    op.op === 'rejectRevision' ||
    op.op === 'acceptAllRevisions' ||
    op.op === 'rejectAllRevisions'
  ) {
    const accept = op.op === 'acceptRevision' || op.op === 'acceptAllRevisions';
    const resolved = resolveRevisionOperation(part, accept ? 'accept' : 'reject', op, options);
    if (!resolved.ok || !resolved.part || !resolved.effect) {
      return { ok: false, reason: resolved.reason ?? 'tree-invariant' };
    }
    return { ok: true, part: resolved.part, effect: resolved.effect };
  }
  if (op.op === 'setRevisionAttribution') return applySetRevisionAttribution(part, op, options);
  if (op.op === 'removeContentControl')
    return applyRemoveContentControl(part, op.controlId, options);
  if (op.op === 'setSectionProperties') return applySetSectionProperties(part, op, options);
  if (op.op === 'setSectionMark') return applySetSectionMark(part, op, options);
  // Package-lifecycle / note-part ops are refused by validateTreeOp; this arm narrows the
  // union so the story appliers below can address paragraphId safely.
  if (
    op.op === 'createHeaderFooter' ||
    op.op === 'deleteHeaderFooter' ||
    op.op === 'linkToPrevious' ||
    op.op === 'unlinkFromPrevious' ||
    op.op === 'setSectionFurnitureOptions' ||
    op.op === 'setDocumentProtection' ||
    op.op === 'setWatermark' ||
    op.op === 'insertNote' ||
    op.op === 'deleteNote' ||
    op.op === 'convertNote' ||
    op.op === 'convertAllNotes' ||
    op.op === 'setNoteProperties'
  ) {
    return { ok: false, reason: 'invalidArgs', detail: 'package-lifecycle-op' };
  }
  if (op.op === 'addRepeatingSectionItem' || op.op === 'removeRepeatingSectionItem') {
    return { ok: false, reason: 'unsupported' };
  }

  const paragraph = findNode(part, op.paragraphId) as OoxmlParagraphNode;
  const nextId = createNodeIdAllocator(part);

  switch (op.op) {
    case 'insertText':
      if (op.revision) {
        const { offset, text, revision, bias } = op;
        const edge = op.inside && trackedTextAtControlEdge(part, paragraph, op, options);
        return edge || applyInsertTracked(part, paragraph, offset, text, revision, options, bias);
      }
      return applyInsertContent(
        part,
        paragraph,
        op.offset,
        textWithHyphenBuilders(op.text),
        options,
        op.inside,
        op.bias
      );
    case 'insertTab':
    case 'insertHardBreak':
    case 'insertPageBreak': {
      // ONE builder per op, shared by the tracked and untracked arms — two lambdas per op
      // would let suggesting mode insert a different element than edit mode for the same key.
      const element = RUN_ELEMENT_INSERTS[op.op];
      if (op.revision) {
        return applyInsertTrackedElement(
          part,
          paragraph,
          op.offset,
          element,
          op.revision,
          options,
          op.bias
        );
      }
      return applyInsertContent(part, paragraph, op.offset, [element], options, undefined, op.bias);
    }
    case 'setListLevel':
      return applySetListLevel(part, paragraph, op.level, options, nextId, op.revision);
    case 'setParagraphMarkProperties':
      return applySetParagraphMarkProperties(
        part,
        paragraph,
        op.properties,
        options,
        nextId,
        op.revision
      );
    case 'setListNumbering':
      return applySetListNumbering(
        part,
        paragraph,
        op.numId,
        op.level ?? 0,
        options,
        nextId,
        op.revision
      );
    case 'setParagraphBorders':
      return applySetParagraphBorders(part, paragraph, op, options, nextId);
    case 'setParagraphTabStops':
      return applySetParagraphTabStops(
        part,
        paragraph,
        op.stops,
        op.inForcePositionsTwips,
        options,
        nextId
      );
    case 'insertComplexField':
      return applyInsertComplexField(part, paragraph, op, options);
    case 'insertPageField': {
      // ONE builder list per field, shared by the tracked and untracked arms — the same
      // rule the tab/break ops state, so suggesting mode cannot insert a different field
      // shape than edit mode for the same command.
      const builders = pageFieldContentBuilders(op.field);
      if (op.revision) {
        return applyInsertTrackedElements(
          part,
          paragraph,
          op.offset,
          (mint) => builders.map((build) => build(mint)),
          pageFieldModelLength(op.field),
          op.revision,
          options
        );
      }
      return applyInsertContent(part, paragraph, op.offset, builders, options);
    }
    case 'deleteText':
      if (op.revision) {
        return applyDeleteTracked(part, paragraph, op.start, op.end, op.revision, options);
      }
      return applyDeleteText(part, paragraph, op.start, op.end, options);
    case 'insertHyperlink':
      return applyInsertHyperlink(part, paragraph, op, options);
    case 'insertInlineContentControl':
      return applyInsertInlineContentControl(part, paragraph, op, options);
    case 'setParagraphMarkRevision': {
      // Taking your own proposed break back is a real join, not a second proposal.
      if (op.kind === 'del' && retractsOwnParagraphMark(paragraph, op.revision.author)) {
        const parent = parentOf(part, paragraph.id);
        const at = parent?.children.findIndex((child) => child.id === paragraph.id) ?? -1;
        const next = at >= 0 ? parent?.children[at + 1] : undefined;
        if (next && next.kind === 'paragraph') {
          return applyJoin(part, paragraph.id, next.id, options);
        }
      }
      return applyParagraphMarkRevision(part, paragraph, op.kind, op.revision, options);
    }
    case 'proposeParagraphMerge': {
      // THE SAME RULE, ON THE LANE BACKSPACE ACTUALLY TAKES. A join is addressed by the
      // SECOND paragraph, because the mark between two paragraphs belongs to the first — so
      // the mark being proposed away here is the PREVIOUS paragraph's, and the case above
      // never sees it. Enter then Backspace in suggesting mode therefore stacked a `w:del`
      // on the `w:ins` the same author had written a second earlier: two cards in the rail
      // for a decision nobody made, an empty paragraph left standing in the document, and a
      // mark whose Reject makes permanent the very break the user just took back.
      const parent = parentOf(part, paragraph.id);
      const at = parent?.children.findIndex((child) => child.id === paragraph.id) ?? -1;
      const previous = at > 0 ? parent?.children[at - 1] : undefined;
      if (
        previous &&
        previous.kind === 'paragraph' &&
        retractsOwnParagraphMark(previous, op.revision.author)
      ) {
        return applyJoin(part, previous.id, paragraph.id, options);
      }
      return applyProposeParagraphMerge(part, paragraph, op.revision, options);
    }
    case 'splitParagraph':
      return applySplit(part, paragraph, op.offset, options, op.tailStyleId);
    case 'splitParagraphMany': {
      const split = applySplitMany(part, paragraph, op.offsets, options);
      if (!op.revision || !split.ok) return split;
      // EVERY BOUNDARY IS A MARK THIS AUTHOR IS ADDING. `splitParagraph` proposes its one
      // break through a companion `setParagraphMarkRevision`, which the caller can address
      // because the paragraph exists before the op. The many-split mints its paragraphs here,
      // so the marks have to be stamped here too: on the head and on every tail except the
      // last, which keeps the mark the original paragraph already had. Paste is the lane that
      // emits this op, and without it a multi-line paste in suggesting mode tracked its text
      // and not its breaks — Reject left the extra paragraphs behind for good.
      const marked = [paragraph.id, ...split.effect.created.slice(0, -1)];
      let current = split;
      for (const id of marked) {
        const target = findNode(current.part, id);
        if (!target || target.kind !== 'paragraph') continue;
        const stamped = applyParagraphMarkRevision(
          current.part,
          target,
          'ins',
          op.revision,
          options
        );
        if (!stamped.ok) return stamped;
        current = { ...stamped, effect: { ...split.effect } };
      }
      return current;
    }
    case 'setRunProperties':
      return applySetRunProperties(
        part,
        paragraph,
        op.start,
        op.end,
        op.properties,
        options,
        op.targetRunIds,
        op.revision
      );
    case 'setParagraphProperties': {
      const existing = paragraphPropertiesNodeOf(paragraph);
      const prior = existing?.children ?? [];
      let children: readonly OoxmlNode[] = mergedPropertyChildren(
        prior,
        op.properties,
        PARAGRAPH_VOCABULARY,
        nextId
      );
      // A tracked paragraph-property change records what `w:pPr` held in a `w:pPrChange`
      // (§17.13.5.29), so Reject restores the alignment, indents and style it replaced.
      //
      // Skipped on a paragraph whose mark THIS author proposed adding, the same rule the run
      // and mark writes apply: rejecting that `w:ins` runs the paragraph into the next one and
      // takes its properties with it, so a record of what they used to be decides nothing.
      const markProperties = namedChild(existing, 'rPr')?.children ?? [];
      if (
        op.revision &&
        !ownProposedParagraph(part, paragraph.id, markProperties, op.revision.author)
      ) {
        children = withPropertyChangeRecord({
          container: 'paragraphProperties',
          prior,
          next: children,
          revision: op.revision,
          mint: nextId,
          // The transaction's minter when it lent one, else a lazy walk of this part.
          nextRevisionId: () => options?.revisionIds?.() ?? nextRevisionId(part)(),
        });
      }
      const effect: TreeOpEffect = {
        dirty: [paragraph.id],
        created: [],
        deleted: [],
        dependencyKeys: TEXT_DEPS,
        impact: 'paragraph-local',
      };
      if (children.length === 0) {
        // Nothing left to hold: the container goes rather than staying as an empty `w:pPr`,
        // so a cleared paragraph digests identically to one that never had any.
        return existing
          ? fromEdit(removeNode(part, existing.id, options), effect)
          : ok(part, effect);
      }
      if (existing) return fromEdit(replaceChildren(part, existing.id, children, options), effect);
      const pPr = {
        id: nextId(),
        kind: 'paragraphProperties',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'pPr',
        prefix: 'w',
        namespaceBindings: [],
        attributes: [],
        children,
      } as unknown as OoxmlNode;
      // `w:pPr` must be the paragraph's FIRST child per the schema.
      return fromEdit(insertChildren(part, paragraph.id, 0, [pPr], options), effect);
    }
    default:
      return { ok: false, reason: 'unknown-op' };
  }
}

/** Insert content nodes at a UTF-16 offset, splitting a text value when the offset is inside one. */
function applyInsertContent(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  builders: readonly ((mint: () => string) => OoxmlNode)[],
  options?: EditOptions,
  /** The content control the caller says this content belongs to, if it named one. */
  inside?: string,
  bias?: 'left' | 'right'
): TreeOpResult {
  const control = contentControlAtCaret(part, paragraph, offset, offset, bias);
  if (control && isShowingPlaceholder(control)) {
    return applyPlaceholderReplace(part, control, builders, options);
  }

  const nextId = createNodeIdAllocator(part);
  const nodes = builders.map((build) => build(nextId));
  const segments = segmentsOf(paragraph);
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'text-local',
  };
  // A named owner narrows the offset to that control's OWN characters. Without it the trailing
  // edge resolves to the run after the control, which is beside the field rather than in it.
  const found = inside === undefined ? null : findNode(part, inside);
  if (inside !== undefined && (found === null || found.kind === 'textValue')) {
    return { ok: false, reason: 'unknown-content-control' };
  }
  const owner = found?.kind === 'textValue' ? null : found;
  // ONE resolution of where this lands, shared with the validation that refuses it. Two copies
  // of this rule is how a lock came to be resolved against a different place than the write.
  const site = insertionDestination(paragraph, offset, owner, bias).site;

  // Plain typing changes the existing leaf, rather than copying its text into newly
  // minted containers. Shared split ranges address that leaf, including after formatting
  // has replaced its run. Tabs, breaks, atoms, and deleted text keep their structural paths.
  const insertIntoText = (segment: Segment | undefined): TreeOpResult | null => {
    const content = nodes.length === 1 ? nodes[0] : undefined;
    const text =
      content?.kind === 'text' && content.children.length === 1 ? content.children[0] : undefined;
    if (
      !segment ||
      segment.removeNodeIds ||
      segment.node.kind !== 'textValue' ||
      text?.kind !== 'textValue'
    )
      return null;
    const owner = findTextParent(paragraph, segment.node.id);
    if (owner?.kind !== 'text' || owner.children.length !== 1) return null;
    const local = offset - segment.start;
    return finishContentEdit(
      fromEdit(
        replaceNode(
          part,
          segment.node.id,
          {
            ...segment.node,
            value:
              segment.node.value.slice(0, local) + text.value + segment.node.value.slice(local),
          },
          deferOptions(options, control)
        ),
        effect
      ),
      control,
      options
    );
  };

  let inserted: TreeOpResult;
  // Inside a text value: split it and place the new content between the halves.
  if (site.kind === 'withinValue') {
    const segment = site.segment;
    if (segment.node.kind !== 'textValue') return { ok: false, reason: 'tree-invariant' };
    const local = offset - segment.start;
    const value = segment.node.value;
    const textNode = findTextParent(paragraph, segment.node.id);
    if (!textNode) return { ok: false, reason: 'tree-invariant', detail: 'orphan text value' };
    const run = findNode(part, segment.runId);
    if (!run || run.kind !== 'run') return { ok: false, reason: 'tree-invariant' };
    // INSIDE struck text: the caret may rest there, but new content goes BESIDE the deletion,
    // never into it — the same rule the tracked lane states (`tree-op-tracked.ts`). Split in
    // place, the new nodes serialized as `w:t` under a wrapper that requires `w:delText`, and
    // an accept of that unrelated deletion took the typed words with it.
    if (textNode.kind === 'deletedText') {
      const relocated = insertBesideDeletion(part, paragraph, run, nodes, 'after', {
        nextId,
        effect,
        control,
        options,
      });
      if (relocated) return relocated;
    }
    const plain = insertIntoText(segment);
    if (plain) return plain;
    const kind = textNode.kind === 'deletedText' ? 'deletedText' : 'text';
    const head = textElement(nextId, value.slice(0, local), kind);
    const tail = textElement(nextId, value.slice(local), kind);
    const rebuilt = run.children.flatMap((child) =>
      child.id === textNode.id ? [head, ...nodes, tail] : [child]
    );
    inserted = fromEdit(
      replaceChildren(part, run.id, rebuilt, deferOptions(options, control)),
      effect
    );
    return finishContentEdit(inserted, control, options);
  }

  if (site.kind === 'atRunIndex') {
    if (bias !== 'right' && noteReferenceEndingAt(paragraph, offset)) {
      const edited = insertAfterNoteInRun(
        part,
        paragraph,
        offset,
        site.run,
        site.index,
        nodes,
        nextId,
        deferOptions(options, control)
      );
      return edited
        ? finishContentEdit(fromEdit(edited, effect), control, options)
        : { ok: false, reason: 'tree-invariant' };
    }
    // Text right before the index takes plain typing in place, rather than gaining a sibling
    // `w:t` per keystroke. Only that node: an earlier one would sit before the index.
    const prior = site.run.children[site.index - 1];
    const joined = prior
      ? findLast(segments, (segment) => segment.runId === site.run.id && segment.end === offset)
      : undefined;
    if (joined && prior && contains(prior, joined.node.id)) {
      const plain = insertIntoText(joined);
      if (plain) return plain;
    }
    return finishContentEdit(
      fromEdit(
        insertChildren(part, site.run.id, site.index, nodes, deferOptions(options, control)),
        effect
      ),
      control,
      options
    );
  }

  if (inside !== undefined) {
    if (site.kind === 'atBoundary') {
      const plain = insertIntoText(site.segment);
      if (plain) return plain;
      const run = findNode(part, site.segment.runId);
      if (!run || run.kind !== 'run') return { ok: false, reason: 'tree-invariant' };
      const index = run.children.findIndex((child) => contains(child, site.segment.node.id));
      inserted = fromEdit(
        insertChildren(part, run.id, Math.max(0, index), nodes, deferOptions(options, control)),
        effect
      );
      return finishContentEdit(inserted, control, options);
    }
    if (site.kind === 'appendToRun') {
      const plain = insertIntoText(
        findLast(segments, (segment) => segment.runId === site.run.id && segment.end === offset)
      );
      if (plain) return plain;
      inserted = fromEdit(
        insertChildren(
          part,
          site.run.id,
          site.run.children.length,
          nodes,
          deferOptions(options, control)
        ),
        effect
      );
      return finishContentEdit(inserted, control, options);
    }
    inserted = fromEdit(
      insertChildren(
        part,
        site.holder.id,
        site.holder.children.length,
        [runElement(nextId, nodes)],
        deferOptions(options, control)
      ),
      effect
    );
    return finishContentEdit(inserted, control, options);
  }

  if (site.kind === 'newRun') {
    // The left run still wins its formatting. A minted run at a wrapper's leading edge sits
    // right after the preceding run, so typing there inherits that run's properties exactly
    // as it does at an ordinary boundary; a bare run came out unformatted instead.
    // Beside a control that typing cannot enter, the run outside it wins instead.
    const besideControl = formattingRunBesideRestrictedControl(
      paragraph,
      offset,
      paragraphOffsetIndex(paragraph)
    );
    const leftSegment = findLast(segments, (segment) => segment.end === offset);
    const leftRun =
      besideControl !== undefined
        ? besideControl
        : leftSegment
          ? findNode(part, leftSegment.runId)
          : null;
    const inheritedProperties =
      bias !== 'right' && noteReferenceEndingAt(paragraph, offset)
        ? noteTypingProperties(paragraph, offset, nextId)
        : leftRun && leftRun.kind === 'run'
          ? fieldInsertionEndAt(paragraph, offset)
            ? insertedRunProperties(nextId, leftRun)
            : leftRun.children
                .filter((child) => child.kind === 'runProperties')
                .map((child) => withFreshIds(child, nextId))
          : emptyParagraphRunProperties(paragraph, nextId);
    inserted = fromEdit(
      insertChildren(
        part,
        site.holder.id,
        site.index ?? site.holder.children.length,
        [runElement(nextId, [...inheritedProperties, ...nodes])],
        deferOptions(options, control)
      ),
      effect
    );
    return finishContentEdit(inserted, control, options);
  }

  // AT A BOUNDARY, THE RUN TO THE LEFT WINS.
  //
  // Word types into the run holding the character BEFORE the caret; `authoredRunPropertiesAt`
  // states the same rule for what the toolbar reports, and the two have to agree or the
  // toolbar describes formatting the next keystroke will not use. Joining the run that
  // STARTS at the offset gave typed text the FOLLOWING run's properties — which on a
  // PDF-converted document, where every inter-word space is its own run carrying
  // `w:spacing`, meant typing after a word came out letter-spaced ("x x x x x x").
  //
  // The left run is refused in the two cases where inheriting from it would move the text
  // somewhere it does not belong rather than merely format it: an ATOM (a field or a note
  // reference, whose nodes must stay together), and a run inside a hyperlink or field when
  // the run on the right is not — typing at the end of a link extends the link's text
  // otherwise. Both fall back to the previous rule.
  const before = findLast(segments, (segment) => segment.end === offset);
  const after = segments.find((segment) => segment.start === offset);
  if (
    bias !== 'right' &&
    before &&
    before.removeNodeIds === undefined &&
    !fieldInsertionEndAt(paragraph, offset) &&
    !crossesContentControlBoundary(part, before, after) &&
    !leavesInlineContainer(paragraph, before, after)
  ) {
    const run = findNode(part, before.runId);
    if (!run || run.kind !== 'run') return { ok: false, reason: 'tree-invariant' };
    // The end boundary of a deletion: the left run's characters are struck, and joining it
    // would put the new text inside the `w:del`. Beside it instead — same rule as the
    // interior case above.
    const relocated = insertBesideDeletion(part, paragraph, run, nodes, 'after', {
      nextId,
      effect,
      control,
      options,
    });
    if (relocated) return relocated;
    // Right after a fitted group, the text starts its own run without `w:fitText`.
    if (endsFitTextGroup(run, after ? (findNode(part, after.runId) ?? undefined) : undefined)) {
      const edited = insertAfterFitTextGroup(
        part,
        run,
        nodes,
        nextId,
        deferOptions(options, control)
      );
      if (edited) return finishContentEdit(fromEdit(edited, effect), control, options);
    }
    const plain = insertIntoText(before);
    if (plain) return plain;
    const index = run.children.findIndex((child) => contains(child, before.node.id));
    inserted = fromEdit(
      insertChildren(
        part,
        run.id,
        index < 0 ? run.children.length : index + 1,
        nodes,
        deferOptions(options, control)
      ),
      effect
    );
    return finishContentEdit(inserted, control, options);
  }
  if (after) {
    const run = findNode(part, after.runId);
    if (!run || run.kind !== 'run') {
      // A paragraph-level atom, such as `m:oMath`, has no owning `w:r`. Typing at its
      // leading edge creates a sibling run before it. Treating the atom id as a run id
      // made the otherwise valid caret position fail with `tree-invariant`.
      const parent = parentOf(part, after.node.id);
      if (
        after.removeNodeIds !== undefined &&
        parent?.kind === 'paragraph' &&
        parent.id === paragraph.id
      ) {
        const index = parent.children.findIndex((child) => child.id === after.node.id);
        if (index < 0) return { ok: false, reason: 'tree-invariant' };
        inserted = fromEdit(
          insertChildren(
            part,
            parent.id,
            index,
            [runElement(nextId, nodes)],
            deferOptions(options, control)
          ),
          effect
        );
        return finishContentEdit(inserted, control, options);
      }
      return { ok: false, reason: 'tree-invariant' };
    }
    // The START boundary of a deletion, reached when nothing to the left takes the text:
    // the new content goes before the wrapper, never into the struck run's head.
    const relocated = insertBesideDeletion(part, paragraph, run, nodes, 'before', {
      nextId,
      effect,
      control,
      options,
    });
    if (relocated) return relocated;
    const plain = insertIntoText(after);
    if (plain) return plain;
    const index = run.children.findIndex((child) => contains(child, after.node.id));
    inserted = fromEdit(
      insertChildren(part, run.id, Math.max(0, index), nodes, deferOptions(options, control)),
      effect
    );
    return finishContentEdit(inserted, control, options);
  }

  // A paragraph-level atom has no owning run. At its trailing boundary, insert a sibling
  // run AFTER the atom instead of appending to the paragraph's last run, which can only be
  // before it. The atom segment names its complete removable node, and the direct-parent
  // check keeps run-owned fields and drawings on their existing insertion paths.
  if (before?.removeNodeIds && before.removeNodeIds.length === 1) {
    const atom = findNode(part, before.removeNodeIds[0]!);
    const parent = atom ? parentOf(part, atom.id) : null;
    if (atom && parent?.kind === 'paragraph' && parent.id === paragraph.id) {
      const index = parent.children.findIndex((child) => child.id === atom.id);
      if (index < 0) return { ok: false, reason: 'tree-invariant' };
      inserted = fromEdit(
        insertChildren(
          part,
          parent.id,
          index + 1,
          [runElement(nextId, nodes)],
          deferOptions(options, control)
        ),
        effect
      );
      return finishContentEdit(inserted, control, options);
    }
  }

  const runs = paragraph.children.filter((child) => child.kind === 'run');
  const last = runs[runs.length - 1];
  // An empty paragraph's face is its mark's character style and direction flags, or the face
  // of an empty run that already carries them (`mark-character-style-run.ts`). The first
  // content goes in a run of its own after the empty runs.
  const markStyled = last ? emptyParagraphRunProperties(paragraph, nextId) : [];
  if (last && markStyled.length > 0) {
    inserted = fromEdit(
      insertChildren(
        part,
        paragraph.id,
        paragraph.children.indexOf(last) + 1,
        [runElement(nextId, [...markStyled, ...nodes])],
        deferOptions(options, control)
      ),
      effect
    );
    return finishContentEdit(inserted, control, options);
  }
  if (last) {
    inserted = fromEdit(
      insertChildren(part, last.id, last.children.length, nodes, deferOptions(options, control)),
      effect
    );
    return finishContentEdit(inserted, control, options);
  }
  // An empty paragraph: the content needs a run to live in.
  inserted = fromEdit(
    insertChildren(
      part,
      paragraph.id,
      paragraph.children.length,
      [runElement(nextId, [...emptyParagraphRunProperties(paragraph, nextId), ...nodes])],
      deferOptions(options, control)
    ),
    effect
  );
  return finishContentEdit(inserted, control, options);
}

/**
 * Insert content BESIDE the deletion a run belongs to, or null when the run is not deleted.
 *
 * New content must never land inside a `w:del`/`w:moveFrom`: it would serialize as `w:t`
 * under a wrapper that requires `w:delText` (§17.3.3.7), and an accept of that unrelated
 * deletion would take the typed words with it. Placed beside the OUTERMOST enclosing
 * revision wrapper: for `w:ins` wrapping `w:del`, landing between the two would put the
 * words inside someone else's insertion, where rejecting their proposal deletes yours. The
 * struck run's own `w:rPr` carries over, so the text keeps the formatting the caret showed.
 */
function insertBesideDeletion(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  run: OoxmlNode,
  nodes: readonly OoxmlNode[],
  side: 'before' | 'after',
  context: {
    readonly nextId: () => string;
    readonly effect: TreeOpEffect;
    readonly control: OoxmlNode | null;
    readonly options?: EditOptions;
  }
): TreeOpResult | null {
  let wrapper: OoxmlNode | null = null;
  let deleted = false;
  for (
    let ancestor = parentOf(part, run.id);
    ancestor && ancestor.id !== paragraph.id;
    ancestor = parentOf(part, ancestor.id)
  ) {
    if (!isContentRevisionKind(ancestor.kind)) continue;
    wrapper = ancestor;
    if (ancestor.kind === 'revisionDelete' || ancestor.kind === 'revisionMoveFrom') {
      deleted = true;
    }
  }
  if (!deleted || !wrapper) return null;
  const holder = parentOf(part, wrapper.id);
  if (!holder) return { ok: false, reason: 'tree-invariant' };
  const at = holder.children.findIndex((child) => child.id === wrapper.id);
  if (at < 0) return { ok: false, reason: 'tree-invariant' };
  const properties = (run.kind === 'textValue' ? [] : run.children)
    .filter((child) => isRunPropertiesNode(child))
    .map((child) => cloneWithNewIds(child, context.nextId));
  const inserted = fromEdit(
    insertChildren(
      part,
      holder.id,
      side === 'after' ? at + 1 : at,
      [runElement(context.nextId, [...properties, ...nodes])],
      deferOptions(context.options, context.control)
    ),
    context.effect
  );
  return finishContentEdit(inserted, context.control, context.options);
}

/** Defer validation when a temporary unwrap still has to run in this op. */
function deferOptions(
  options: EditOptions | undefined,
  control: OoxmlNode | null
): EditOptions | undefined {
  if (control && isTemporaryControl(control)) {
    return { ...options, deferValidation: true };
  }
  return options;
}

/** After a content edit: a temporary control unwraps (a locked wrapper was refused by
 * validation), and any other control the edit emptied shows its prompt again. */
function finishContentEdit(
  result: TreeOpResult,
  control: OoxmlNode | null,
  options?: EditOptions
): TreeOpResult {
  if (!result.ok || !control) return result;
  if (!isTemporaryControl(control)) return restoreEmptiedPlaceholder(result, control.id, options);
  // Re-find: the control id is stable across the preceding content edit.
  const stillThere = findContentControl(result.part, control.id);
  if (!stillThere) return result;
  const unwrapped = applyRemoveContentControl(result.part, control.id, options);
  if (!unwrapped.ok) return unwrapped;
  return ok(unwrapped.part, {
    dirty: [...new Set([...result.effect.dirty, ...unwrapped.effect.dirty])],
    created: result.effect.created,
    deleted: result.effect.deleted,
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  });
}

/**
 * First input into a `w:showingPlcHdr` control: replace the whole literal prompt and clear
 * the flag. When the control is also `w:temporary`, unwrap in the same write.
 */
function applyPlaceholderReplace(
  part: OoxmlPart,
  control: OoxmlNode,
  builders: readonly ((mint: () => string) => OoxmlNode)[],
  options?: EditOptions
): TreeOpResult {
  const nextId = createNodeIdAllocator(part);
  const nodes = builders.map((build) => build(nextId));
  const owner = parentOf(part, control.id);
  const inline = contentControlLevelOf(control) === 'inline';
  // The inserted content becomes the display run inside whatever the prompt wrapped, so a
  // prompt around a cell keeps the cell. Content no insertion can stand in for is refused.
  const contentChildren = valueContent(
    contentControlContentOf(control),
    (properties) => runElement(nextId, properties ? [properties, ...nodes] : nodes),
    nextId,
    inline
  );
  if (!contentChildren) return { ok: false, reason: 'unsupported' };
  let nextControl = replaceControlContent(control, contentChildren, nextId);
  nextControl = withUpdatedProperties(nextControl, clearShowingPlaceholder);

  // A BLOCK placeholder replace can delete prompt paragraphs and mint a fresh one, so the
  // paragraph set may change and the effect must say so. Reporting it as 'text-local' with
  // empty created/deleted told paragraph-keyed caches they could keep their answer, and a
  // retained review order index then had no entry for the minted paragraph — an item anchored
  // in it listed in the rail but never activated from a caret. A prompt paragraph kept in
  // place is dirty. The inline branch really is text-local: the owner paragraph survives,
  // only its runs are replaced, and inline content holds no paragraph to diff.
  const effect = withParagraphDiff(
    {
      dirty: owner ? [owner.id] : [control.id],
      created: [],
      deleted: [],
      dependencyKeys: TEXT_DEPS,
      impact: !inline || isTemporaryControl(control) ? 'flow-structural' : 'text-local',
    },
    control,
    nextControl
  );

  if (isTemporaryControl(control)) {
    // Build the unwrapped parent children from the replaced content — one tree write.
    if (!owner) return { ok: false, reason: 'tree-invariant' };
    const kept = contentControlUnwrapPayload(nextControl);
    if (!kept) return { ok: false, reason: 'tree-invariant' };
    const children = owner.children.flatMap((child) => (child.id === control.id ? kept : [child]));
    return fromEdit(replaceChildren(part, owner.id, children, options), {
      ...effect,
      impact: 'flow-structural',
    });
  }

  return fromEdit(replaceNode(part, control.id, nextControl, options), effect);
}

function findLast<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (predicate(item)) return item;
  }
  return undefined;
}

/** Inline-control edges stay right-biased even though ordinary run boundaries inherit left. */
function crossesContentControlBoundary(
  part: OoxmlPart,
  before: { readonly runId: string },
  after: { readonly runId: string } | undefined
): boolean {
  const beforeControl = innermostContentControlAround(part, before.runId)?.id;
  const afterControl = after ? innermostContentControlAround(part, after.runId)?.id : undefined;
  return beforeControl !== afterControl;
}

function findTextParent(paragraph: OoxmlParagraphNode, valueId: string): OoxmlNode | null {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (
      (node.kind === 'text' || node.kind === 'deletedText') &&
      node.children.some((child) => child.id === valueId)
    ) {
      return node;
    }
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(paragraph);
}

function applyDeleteText(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  options?: EditOptions
): TreeOpResult {
  const control = contentControlAtCaret(part, paragraph, start, end);
  const editOptions = deferOptions(options, control);
  const segments = segmentsOf(paragraph);
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'text-local',
  };
  let current = part;

  const fieldsRemoved = removeCoveredTextFormDefinitions(
    current,
    paragraph,
    start,
    end,
    editOptions
  );
  if (!fieldsRemoved.ok) return fieldsRemoved;
  current = fieldsRemoved.part;

  // Highest offset first, so earlier segment positions stay valid as edits apply.
  for (const segment of [...segments].reverse()) {
    if (segment.end <= start || segment.start >= end) continue;
    if (segment.removeNodeIds && segment.removeNodeIds.length > 0) {
      // Atomic field: remove begin→end (or fldSimple) as one unit. Partial overlap still
      // deletes the whole field — caret cannot land inside the unit.
      for (const nodeId of segment.removeNodeIds) {
        if (!findNode(current, nodeId)) continue;
        const removed = removeNode(current, nodeId, options);
        if (!removed.ok) return fromEdit(removed, effect);
        current = removed.part;
      }
      continue;
    }
    if (segment.node.kind !== 'textValue') {
      const removed = removeNode(current, segment.node.id, editOptions);
      if (!removed.ok) return fromEdit(removed, effect);
      current = removed.part;
      continue;
    }
    const from = Math.max(0, start - segment.start);
    const to = Math.min(segment.node.value.length, end - segment.start);
    const value = segment.node.value.slice(0, from) + segment.node.value.slice(to);
    const owner = findTextParent(paragraph, segment.node.id);
    if (!owner) return { ok: false, reason: 'tree-invariant', detail: 'orphan text value' };
    const edited = replaceNode(current, segment.node.id, { ...segment.node, value }, editOptions);
    if (!edited.ok) return fromEdit(edited, effect);
    current = edited.part;
    if (value.length === 0) {
      // Publish the source deletion before removing its container. Concurrent formatting
      // may still reference this leaf through a split range after the owner disappears.
      const removed = removeNode(current, owner.id, editOptions);
      if (!removed.ok) return fromEdit(removed, effect);
      current = removed.part;
    }
  }

  // Drop runs left with no content. A run holding only `w:rPr` renders nothing and would
  // otherwise accumulate on every deletion. Runs inside a HYPERLINK are swept too — they
  // empty exactly the same way — and a link whose last run went with them is removed
  // outright: a `w:hyperlink` with no runs is a target with nothing to click, and leaving it
  // behind would make the next character typed at that offset silently join the dead link.
  const after = findNode(current, paragraph.id);
  if (after && after.kind === 'paragraph') {
    const sweep = (children: readonly OoxmlNode[], depth: number): TreeOpResult | null => {
      if (depth >= MAX_INLINE_CONTAINER_DEPTH) return null;
      for (const child of children) {
        if (child.kind === 'generic' && isInlineRunContainer(child)) {
          // The generic wrapper is authored structure and survives empty. Its empty runs do not.
          const nested = sweep(child.children, depth + 1);
          if (nested) return nested;
          continue;
        }
        if (child.kind === 'hyperlink') {
          const nested = sweep(child.children, depth + 1);
          if (nested) return nested;
          const link = findNode(current, child.id);
          if (link && link.kind !== 'textValue' && runsUnder(link).length === 0) {
            // SPLICE, never remove the subtree. A link emptied of runs can still hold
            // bookmark and comment-range markers, and removing the element took them with
            // it — an anchor other links point at, or a `commentRangeEnd` whose start is
            // still in the paragraph. The same markers written OUTSIDE a link survive the
            // identical deletion, so removing them here was an inconsistency as well as a
            // loss. Only the wrapper goes; whatever it held stays where it was.
            const parent = parentOf(current, child.id);
            if (!parent) return { ok: false, reason: 'tree-invariant' };
            const spliced = replaceChildren(
              current,
              parent.id,
              parent.children.flatMap((sibling) =>
                sibling.id === child.id ? [...link.children] : [sibling]
              ),
              editOptions
            );
            if (!spliced.ok) return fromEdit(spliced, effect);
            current = spliced.part;
          }
          continue;
        }
        if (child.kind !== 'textValue' && isContentRevisionKind(child.kind)) {
          const nested = sweep(child.children, depth + 1);
          if (nested) return nested;
          const wrapper = findNode(current, child.id);
          if (wrapper && wrapper.kind !== 'textValue' && runsUnder(wrapper).length === 0) {
            // A revision wrapper is a claim ABOUT content — "these words were inserted",
            // "these were struck". Delete the words untracked and the claim has no subject
            // left, but the empty `w:ins`/`w:del` used to stay: `collectRevisionSites` kept
            // finding it, so the rail drew a card with an author, a date and no text, and
            // Accept All still had a decision to make about nothing. The TRACKED delete
            // path has always dropped a wrapper it emptied; this is the same rule for the
            // untracked one.
            //
            // SPLICED like a hyperlink, not removed: `EG_ContentRunContent` lets a
            // revision hold comment-range and bookmark markers, and taking the subtree
            // would take those with it — a `commentRangeEnd` whose start is still in the
            // paragraph. Only the wrapper goes.
            const parent = parentOf(current, child.id);
            if (!parent) return { ok: false, reason: 'tree-invariant' };
            const spliced = replaceChildren(
              current,
              parent.id,
              parent.children.flatMap((sibling) =>
                sibling.id === child.id ? [...wrapper.children] : [sibling]
              ),
              editOptions
            );
            if (!spliced.ok) return fromEdit(spliced, effect);
            current = spliced.part;
          }
          continue;
        }
        if (isContentControlNode(child)) {
          // Empty content controls KEEP their wrapper — locks and identity matter — and
          // only empty runs inside them are swept.
          const content = contentControlContentOf(child);
          if (content) {
            const nested = sweep(content.children, depth + 1);
            if (nested) return nested;
          }
          continue;
        }
        if (child.kind !== 'run') continue;
        // A run's children are elements only, so "content" is simply anything that is not
        // the run's own property container.
        const hasContent = child.children.some((grand) => !isRunPropertiesNode(grand));
        if (hasContent) continue;
        const removed = removeNode(current, child.id, editOptions);
        if (!removed.ok) return fromEdit(removed, effect);
        current = removed.part;
      }
      return null;
    };
    const failure = sweep(after.children, 0);
    if (failure) return failure;
  }
  return finishContentEdit(ok(current, effect), control, options);
}

/** The `r:id` namespace — the one attribute on a `w:hyperlink` that is not in `w:`. */
const RELATIONSHIP_NAMESPACE_URI =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * A `w:hyperlink` element with the attributes an op asked for.
 *
 * `w:history="1"` is written on every link Word creates — it is the "followed links" flag,
 * and a link without it reads as an oddity in Word's own UI. Attribute VALUES are validated
 * by `validateHyperlinkTarget` before this runs, so nothing unescapable reaches the tree; the
 * serializer escapes on the way out regardless.
 */
function hyperlinkElement(
  nextId: () => string,
  target: {
    readonly relationshipId?: string;
    readonly anchor?: string;
    readonly tooltip?: string;
  },
  children: readonly OoxmlNode[]
): OoxmlNode {
  const attributes: OoxmlAttribute[] = [
    {
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'history',
      prefix: 'w',
      value: '1',
    },
  ];
  if (target.relationshipId !== undefined) {
    attributes.push({
      kind: 'genericExtension',
      namespaceUri: RELATIONSHIP_NAMESPACE_URI,
      localName: 'id',
      prefix: 'r',
      value: target.relationshipId,
    });
  }
  if (target.anchor !== undefined) {
    attributes.push({
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'anchor',
      prefix: 'w',
      value: target.anchor,
    });
  }
  if (target.tooltip !== undefined) {
    attributes.push({
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'tooltip',
      prefix: 'w',
      value: target.tooltip,
    });
  }
  // Declare xmlns:r on the link when it carries r:id. Body stories usually inherit
  // that binding from w:document, but header/footer and notes parts often only declare
  // xmlns:w - without a local binding the attribute fails the part invariant.
  const namespaceBindings =
    target.relationshipId !== undefined
      ? [{ prefix: 'r', namespaceUri: RELATIONSHIP_NAMESPACE_URI }]
      : [];
  return {
    id: nextId(),
    kind: 'hyperlink',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'hyperlink',
    prefix: 'w',
    namespaceBindings,
    attributes,
    children,
  } as unknown as OoxmlNode;
}

/**
 * Mark a run with a character style (`w:rStyle`), keeping everything else it carries.
 *
 * `w:rStyle` is the FIRST child of `w:rPr` (CT_RPr, ECMA-376 §17.3.2.27) and there is at
 * most one, so an existing reference is REPLACED in place rather than joined by a second —
 * two `w:rStyle` children make the `w:rPr` schema-invalid, which Word repairs by dropping
 * the run's formatting entirely.
 */
function withCharacterStyle(
  node: OoxmlNode,
  styleId: string,
  nextId: () => string,
  depth = 0
): OoxmlNode {
  if (depth >= MAX_INLINE_CONTAINER_DEPTH) return node;
  // A revision wrapper is not a run: the style goes on the runs INSIDE it. Marking the
  // wrapper itself minted a `w:rPr` child on `w:ins` — a shape `CT_RunTrackChange` has no
  // room for — the moment a link was applied over tracked display text, which is every
  // link created in suggesting mode.
  if (isInlineRunContainer(node)) {
    return withChildren(
      node,
      node.children.map((child) => withCharacterStyle(child, styleId, nextId, depth + 1)),
      null
    );
  }
  if (node.kind !== 'run') return node;
  const rStyle = characterStyleElement(nextId, styleId);

  const rPr = runPropertiesNodeOf(node);
  if (!rPr) {
    const created = {
      id: nextId(),
      kind: 'runProperties',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'rPr',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [rStyle],
    } as unknown as OoxmlNode;
    // `w:rPr` must be the run's first child.
    return withChildren(node, [created, ...node.children], null);
  }
  const withoutOld = rPr.children.filter(
    (child) =>
      child.kind === 'textValue' ||
      child.localName !== 'rStyle' ||
      // Namespace-checked: an `<x:rStyle>` from a foreign namespace is preserved content,
      // not the WML character-style reference this replaces.
      child.namespaceUri !== WML_NAMESPACE_URI
  );
  const nextRpr = withChildren(rPr, [rStyle, ...withoutOld], null);
  return withChildren(
    node,
    node.children.map((child) => (child.id === rPr.id ? nextRpr : child)),
    null
  );
}

/**
 * Wrap `[start, end)` of a paragraph in a `w:hyperlink`.
 *
 * The paragraph's inline children are walked once and sorted into three buckets — before the
 * range, inside it, after it — with any child straddling an edge divided by the SAME
 * `divideInline` a split uses, so a link that starts mid-word cuts the run exactly where a
 * paragraph break would. The three buckets are then reassembled with the middle wrapped, in
 * one `replaceChildren`, so the whole insert is a single tree revision.
 *
 * `styleId` marks the wrapped runs with a character style (`w:rStyle`), which is how Word
 * makes a new link LOOK like one. It is written here rather than through `setRunProperties`
 * because `w:rStyle` is preserved, not accepted: it is not in the set a property write
 * replaces, so routing it through one would make a later bold toggle delete it. Direct
 * formatting on the runs is untouched — a style reference sits beside it, and the cascade
 * already resolves direct formatting as the winner.
 */
function applyInsertHyperlink(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  op: { readonly start: number; readonly end: number } & {
    readonly relationshipId?: string;
    readonly anchor?: string;
    readonly tooltip?: string;
    readonly styleId?: string;
  },
  options?: EditOptions
): TreeOpResult {
  const nextId = createNodeIdAllocator(part);
  const segments = segmentsOf(paragraph);
  const before: OoxmlNode[] = [];
  const inside: OoxmlNode[] = [];
  const after: OoxmlNode[] = [];
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'paragraph-local',
  };

  let cursor = 0;
  for (const child of paragraph.children) {
    if (isParagraphPropertiesNode(child)) continue;
    const childSegments = segmentsForChild(child, segments);
    if (childSegments.length === 0) {
      // Zero-length content takes the bucket its POSITION puts it in: a bookmark marker
      // inside the linked range belongs inside the link, one before it stays outside.
      (cursor < op.start ? before : cursor < op.end ? inside : after).push(child);
      continue;
    }
    const childStart = childSegments[0]!.start;
    const childEnd = childSegments[childSegments.length - 1]!.end;
    cursor = childEnd;
    if (childEnd <= op.start) {
      before.push(child);
      continue;
    }
    if (childStart >= op.end) {
      after.push(child);
      continue;
    }
    if (childStart >= op.start && childEnd <= op.end) {
      inside.push(child);
      continue;
    }
    // Straddles an edge. Cut at BOTH offsets in one pass against the original segments.
    //
    // Cutting twice in sequence does not work: the second cut would run against a run this
    // function had just rebuilt, whose fresh node ids appear in no segment, so every child
    // read as unplaceable and the trailing text silently vanished. The many-way divide
    // already answers exactly this question — where does each character go, given these
    // boundaries — measured once against the tree as it stands.
    const [outsideBefore, within, outsideAfter] = distributeInline(
      child,
      [op.start, op.end],
      3,
      segments,
      nextId
    );
    before.push(...outsideBefore!);
    inside.push(...within!);
    after.push(...outsideAfter!);
  }

  if (inside.length === 0) return { ok: false, reason: 'invalid-range' };
  const styled =
    op.styleId === undefined
      ? inside
      : inside.map((child) => withCharacterStyle(child, op.styleId!, nextId));
  const link = hyperlinkElement(nextId, op, styled);
  const pPr = paragraphPropertiesNodeOf(paragraph);
  const children = [...(pPr ? [pPr] : []), ...before, link, ...after];
  return fromEdit(replaceChildren(part, paragraph.id, children, options), effect);
}

/**
 * Insert a NEW run-level `w:sdt` at a collapsed text offset.
 *
 * The paragraph's children divide at the offset exactly the way
 * `applyInsertHyperlink` divides a range — the same distribute machinery, with
 * an empty middle — and the freshly built control lands between the halves.
 * A run-level SDT is a SIBLING of runs, never inside one, which is why this
 * does not go through `applyInsertContent` (that path splices into a run's
 * children, where a `w:sdt` is invalid structure).
 */
function applyInsertInlineContentControl(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  op: {
    readonly offset: number;
    readonly tag: string;
    readonly text: string;
    readonly alias?: string;
    readonly lock?: 'sdtLocked' | 'sdtContentLocked' | 'contentLocked';
    readonly dataBinding?: {
      readonly prefixMappings: string;
      readonly xpath: string;
      readonly storeItemId: string;
    };
    readonly revision?: RevisionAttributionInput;
  },
  options?: EditOptions
): TreeOpResult {
  const nextId = createNodeIdAllocator(part);
  const segments = segmentsOf(paragraph);
  const before: OoxmlNode[] = [];
  const after: OoxmlNode[] = [];
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'paragraph-local',
  };

  let cursor = 0;
  for (const child of paragraph.children) {
    if (isParagraphPropertiesNode(child)) continue;
    const childSegments = segmentsForChild(child, segments);
    if (childSegments.length === 0) {
      // Zero-length content takes the bucket its POSITION puts it in, exactly
      // as the hyperlink divide treats markers.
      (cursor < op.offset ? before : after).push(child);
      continue;
    }
    const childStart = childSegments[0]!.start;
    const childEnd = childSegments[childSegments.length - 1]!.end;
    cursor = childEnd;
    if (childEnd <= op.offset) {
      before.push(child);
      continue;
    }
    if (childStart >= op.offset) {
      after.push(child);
      continue;
    }
    // Straddles the offset: one divide against the original segments, for the
    // same reason the hyperlink path cuts once — a second cut would run against
    // rebuilt nodes no segment knows.
    const [left, right] = distributeInline(child, [op.offset], 2, segments, nextId);
    before.push(...left!);
    after.push(...right!);
  }

  // The label INHERITS the neighboring run's formatting, the way typing does —
  // a citation inserted mid-title must not come out body-sized. Left run wins,
  // matching the insert-content boundary rule; falls back to the run on the
  // right at paragraph start.
  const anchorSegment =
    findLast(segments, (segment) => segment.end <= op.offset && segment.end > 0) ??
    segments.find((segment) => segment.start >= op.offset);
  const anchorRun = anchorSegment ? findNode(part, anchorSegment.runId) : null;
  const inheritedProperties =
    anchorRun && anchorRun.kind === 'run' ? runPropertiesNodeOf(anchorRun) : null;

  const built = inlineContentControlElement(
    nextId,
    op,
    inheritedProperties ? remintClone(inheritedProperties, nextId) : null
  );
  // A proposed control is one tracked insertion: the whole `w:sdt` inside a `w:ins`, so a
  // reject takes the control with its text and an accept keeps it.
  const revisionId = op.revision ? nextRevisionId(part)() : '';
  const control = op.revision
    ? build(nextId(), 'revisionInsert', 'ins', revisionAttributes(revisionId, op.revision), [built])
    : built;
  const pPr = paragraphPropertiesNodeOf(paragraph);
  const children = [...(pPr ? [pPr] : []), ...before, control, ...after];
  return fromEdit(replaceChildren(part, paragraph.id, children, options), effect);
}

/** Deep copy with FRESH node ids — reusing ids would corrupt the part's node index. */
function remintClone(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') {
    return { id: nextId(), kind: 'textValue', value: node.value };
  }
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => remintClone(child, nextId)),
  } as OoxmlNode;
}

/** Build the `w:sdt` element: typed kinds, so reads see an ordinary content control. */
function inlineContentControlElement(
  nextId: () => string,
  op: {
    readonly tag: string;
    readonly text: string;
    readonly alias?: string;
    readonly lock?: 'sdtLocked' | 'sdtContentLocked' | 'contentLocked';
    readonly dataBinding?: {
      readonly prefixMappings: string;
      readonly xpath: string;
      readonly storeItemId: string;
    };
  },
  inheritedRunProperties: OoxmlNode | null = null
): OoxmlNode {
  const wmlAttribute = (localName: string, value: string) =>
    ({
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName,
      prefix: 'w',
      value,
    }) as const;
  const valued = (localName: string, value: string): OoxmlNode =>
    ({
      id: nextId(),
      kind: 'generic',
      namespaceUri: WML_NAMESPACE_URI,
      localName,
      prefix: 'w',
      namespaceBindings: [],
      attributes: [
        {
          kind: 'genericExtension',
          namespaceUri: WML_NAMESPACE_URI,
          localName: 'val',
          prefix: 'w',
          value,
        },
      ],
      children: [],
    }) as unknown as OoxmlNode;
  // Property leaves stay GENERIC under a typed properties node — the same shape
  // the parser produces, so a document that round-trips through this op is
  // indistinguishable from one that was authored elsewhere.
  const propertiesId = nextId();
  // Word writes `w:id` on every control it authors — and Word Online DROPS an
  // id-less control on resave, which silently deleted the chip on a cloud
  // round-trip. Deterministic (FNV-1a over the minted node id + tag): same
  // session state produces the same bytes, so the save/reopen digests stay
  // stable. ST_DecimalNumber, positive, never zero. Emitted in CT_SdtPr's
  // schema sequence (alias, tag, id, lock) — the deep validator enforces it.
  const wordId = String(fnv1a32(`${propertiesId} ${op.tag}`) & 0x7fffffff || 1);
  // `w:dataBinding` sits after `w:lock` and before `w:label` in CT_SdtPr's
  // sequence (§17.5.2.6). Out of order Word refuses the whole document rather
  // than ignoring the element, so this is load-bearing rather than tidy —
  // `CONTENT_CONTROL_PROPERTY_ORDER` spells the same sequence and
  // `insert-custom-node-payload.test.ts` asserts what this emits.
  const binding = op.dataBinding;
  const dataBinding = (): OoxmlNode =>
    ({
      id: nextId(),
      kind: 'contentControlDataBinding',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'dataBinding',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [
        wmlAttribute('prefixMappings', binding!.prefixMappings),
        wmlAttribute('xpath', binding!.xpath),
        // `storeItemID`, with that capitalization: it is the attribute name in
        // the schema, and Word matches it case-sensitively.
        wmlAttribute('storeItemID', binding!.storeItemId),
      ],
      children: [],
    }) as unknown as OoxmlNode;
  const properties = {
    id: propertiesId,
    kind: 'contentControlProperties',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'sdtPr',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [
      ...(op.alias === undefined ? [] : [valued('alias', op.alias)]),
      valued('tag', op.tag),
      valued('id', wordId),
      ...(op.lock === undefined ? [] : [valued('lock', op.lock)]),
      ...(binding ? [dataBinding()] : []),
    ],
  } as unknown as OoxmlNode;
  const content = {
    id: nextId(),
    kind: 'contentControlContent',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'sdtContent',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [
      runElement(nextId, [
        ...(inheritedRunProperties ? [inheritedRunProperties] : []),
        textElement(nextId, op.text),
      ]),
    ],
  } as unknown as OoxmlNode;
  return {
    id: nextId(),
    kind: 'contentControl',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'sdt',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [properties, content],
  } as unknown as OoxmlNode;
}

/** Split only the requested text while retaining each unaffected wrapper's metadata. */
function applyPartialHyperlink(
  part: OoxmlPart,
  op: Extract<TreeDocOp, { op: 'setHyperlinkTarget' | 'removeHyperlink' }>,
  options?: EditOptions
): TreeOpResult {
  const link = findNode(part, op.linkId);
  const paragraph = link && parentOf(part, link.id);
  if (!link || paragraph?.kind !== 'paragraph' || !op.range)
    return { ok: false, reason: 'tree-invariant' };
  const pieces = distributeInline(
    link,
    [op.range.start, op.range.end],
    3,
    segmentsOf(paragraph),
    createNodeIdAllocator(part)
  );
  const selected = pieces[1]?.[0];
  if (selected?.kind !== 'hyperlink') return { ok: false, reason: 'tree-invariant' };
  const replacements = pieces.flat();
  const children = paragraph.children.flatMap((child) =>
    child.id === link.id ? replacements : [child]
  );
  const split = replaceChildren(part, paragraph.id, children, options);
  if (!split.ok)
    return fromEdit(split, {
      dirty: [paragraph.id],
      created: [],
      deleted: [],
      dependencyKeys: TEXT_DEPS,
      impact: 'paragraph-local',
    });
  return op.op === 'removeHyperlink'
    ? applyRemoveHyperlink(split.part, selected.id, options)
    : applySetHyperlinkTarget(split.part, { ...op, linkId: selected.id }, options);
}

/** Re-aim a link: one target attribute replaces the other, and the tooltip follows. */
function applySetHyperlinkTarget(
  part: OoxmlPart,
  op: {
    readonly linkId: string;
    readonly relationshipId?: string;
    readonly anchor?: string;
    readonly tooltip?: string;
  },
  options?: EditOptions
): TreeOpResult {
  const link = findNode(part, op.linkId);
  if (!link || link.kind !== 'hyperlink') return { ok: false, reason: 'tree-invariant' };
  const owner = parentOf(part, link.id);
  if (!owner) return { ok: false, reason: 'tree-invariant' };

  // RETAIN EVERYTHING THE OP DID NOT NAME. `w:history`, `w:docLocation` and `w:tgtFrame` are
  // properties of this LINK, not of its target, so re-aiming must not drop them — that is
  // the difference between editing a URL and replacing the element. `w:docLocation` in
  // particular names a location INSIDE the target (ECMA-376 §17.16.22), so dropping it on a
  // retarget would silently change where the link lands. What goes is the old
  // target attribute (whichever of the two it was, since supplying one supersedes both) and
  // the old tooltip when a new one was supplied.
  const retained = link.attributes.filter((attribute) => {
    if (attribute.namespaceUri === RELATIONSHIP_NAMESPACE_URI && attribute.localName === 'id') {
      return false;
    }
    if (attribute.namespaceUri !== WML_NAMESPACE_URI) return true;
    if (attribute.localName === 'anchor') return false;
    if (attribute.localName === 'tooltip') return op.tooltip === undefined;
    return true;
  });
  const target: OoxmlAttribute[] = [];
  if (op.relationshipId !== undefined) {
    target.push({
      kind: 'genericExtension',
      namespaceUri: RELATIONSHIP_NAMESPACE_URI,
      localName: 'id',
      prefix: 'r',
      value: op.relationshipId,
    });
  }
  if (op.anchor !== undefined) {
    target.push({
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'anchor',
      prefix: 'w',
      value: op.anchor,
    });
  }
  if (op.tooltip !== undefined) {
    target.push({
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'tooltip',
      prefix: 'w',
      value: op.tooltip,
    });
  }
  let namespaceBindings = link.namespaceBindings;
  if (
    op.relationshipId !== undefined &&
    !namespaceBindings.some(
      (binding) => binding.prefix === 'r' && binding.namespaceUri === RELATIONSHIP_NAMESPACE_URI
    )
  ) {
    namespaceBindings = [
      ...namespaceBindings,
      { prefix: 'r', namespaceUri: RELATIONSHIP_NAMESPACE_URI },
    ];
  }
  const next = {
    ...link,
    namespaceBindings,
    attributes: [...retained, ...target],
  } as OoxmlNode;
  const effect: TreeOpEffect = {
    dirty: [owner.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'paragraph-local',
  };
  return fromEdit(replaceNode(part, link.id, next, options), effect);
}

/**
 * Unlink: splice the link's children into its parent where the link was.
 *
 * Everything inside keeps its identity — runs, their `w:rPr`, and any bookmark markers — so
 * the text, its formatting and every anchor around it are exactly what they were. Only the
 * wrapper goes. A link with no children removes cleanly rather than leaving an empty slot.
 */
function applyRemoveHyperlink(
  part: OoxmlPart,
  linkId: string,
  options?: EditOptions
): TreeOpResult {
  const link = findNode(part, linkId);
  if (!link || link.kind !== 'hyperlink') return { ok: false, reason: 'tree-invariant' };
  const owner = parentOf(part, link.id);
  if (!owner) return { ok: false, reason: 'tree-invariant' };
  const children = splicedJoined(
    createNodeIdAllocator(part),
    owner.children,
    link.id,
    link.children
  );
  const effect: TreeOpEffect = {
    dirty: [owner.id],
    created: [],
    // `deleted` names PARAGRAPHS the block sequence lost, and an unlink loses none: the
    // paragraph keeps every run it had. Listing the link node here would tell the scheduler
    // the flow changed structurally and make every commit re-project the whole document.
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'paragraph-local',
  };
  return fromEdit(replaceChildren(part, owner.id, children, options), effect);
}

/**
 * Unwrap a content control: splice `w:sdtContent` children (and any other non-property
 * children) into the parent, keeping run/paragraph identity. `w:sdtPr` / `w:sdtEndPr` go.
 * Ambiguous controls (duplicate `w:sdtContent`) refuse rather than silently drop markup.
 */
function applyRemoveContentControl(
  part: OoxmlPart,
  controlId: string,
  options?: EditOptions
): TreeOpResult {
  const control = findContentControl(part, controlId);
  if (!control) return { ok: false, reason: 'tree-invariant' };
  const owner = parentOf(part, control.id);
  if (!owner) return { ok: false, reason: 'tree-invariant' };
  const kept = contentControlUnwrapPayload(control);
  if (!kept) return { ok: false, reason: 'tree-invariant' };
  const children = splicedJoined(createNodeIdAllocator(part), owner.children, control.id, kept);
  const effect: TreeOpEffect = {
    dirty: [owner.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    // Wrapper removal changes block/inline structure for layout; never narrower than
    // flow-structural (content-control-model: Temporary unwrap and remove-control).
    impact: 'flow-structural',
  };
  return fromEdit(replaceChildren(part, owner.id, children, options), effect);
}

export function replaceControlContent(
  control: OoxmlNode,
  contentChildren: readonly OoxmlNode[],
  nextId: () => string
): OoxmlNode {
  if (control.kind === 'textValue') return control;
  const existing = contentControlContentOf(control);
  const contentNode = existing
    ? withChildren(existing, contentChildren, null)
    : ({
        id: nextId(),
        kind: 'generic',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'sdtContent',
        prefix: 'w',
        namespaceBindings: [],
        attributes: [],
        children: contentChildren,
      } as unknown as OoxmlNode);
  const nextChildren: OoxmlNode[] = [];
  let contentPlaced = false;
  for (const child of control.children) {
    if (child.kind !== 'textValue' && child.localName === 'sdtContent') {
      nextChildren.push(contentNode);
      contentPlaced = true;
      continue;
    }
    nextChildren.push(child);
  }
  if (!contentPlaced) nextChildren.push(contentNode);
  return withChildren(control, nextChildren, null);
}

function clearShowingPlaceholder(properties: OoxmlElement): OoxmlNode {
  const children: readonly OoxmlNode[] = properties.children;
  return withChildren(
    properties,
    children.filter((child) => child.kind === 'textValue' || child.localName !== 'showingPlcHdr'),
    null
  );
}

function withUpdatedProperties(
  control: OoxmlNode,
  update: (properties: OoxmlElement) => OoxmlNode
): OoxmlNode {
  if (control.kind === 'textValue') return control;
  const properties = contentControlPropertiesOf(control);
  if (!properties) return control;
  const next = update(properties);
  return withChildren(
    control,
    control.children.map((child) => (child.id === properties.id ? next : child)),
    null
  );
}

function setLastValueOnList(list: OoxmlElement, value: string): OoxmlNode {
  const without = list.attributes.filter((attribute) => attribute.localName !== 'lastValue');
  return {
    ...list,
    attributes: [
      ...without,
      {
        namespaceUri: WML_NAMESPACE_URI,
        prefix: 'w',
        localName: 'lastValue',
        // An attribute cannot hold U+001E or U+001F, so it keeps the hyphens as they are seen.
        value: withDisplayedHyphens(value),
      },
    ],
  } as OoxmlNode;
}

function applySetContentControlValue(
  part: OoxmlPart,
  controlId: string,
  value: string,
  options?: EditOptions
): TreeOpResult {
  const control = findContentControl(part, controlId);
  if (!control) return { ok: false, reason: 'tree-invariant' };
  const nextId = createNodeIdAllocator(part);
  const owner = parentOf(part, control.id);
  const inline = isInlineControl(part, control.id);
  const type = contentControlValueTypeOf(control);
  let nextControl: OoxmlNode = control;

  // The value becomes one run inside whatever structure the control wraps. False means the
  // content is a shape no value can stand in for, and the caller refuses instead of flattening.
  const setTextContent = (display: string): boolean => {
    const children = valueContent(
      contentControlContentOf(nextControl),
      (properties) =>
        runElement(
          nextId,
          properties
            ? [properties, ...textWithHyphens(nextId, display)]
            : textWithHyphens(nextId, display)
        ),
      nextId,
      inline
    );
    if (!children) return false;
    nextControl = replaceControlContent(nextControl, children, nextId);
    nextControl = withUpdatedProperties(nextControl, clearShowingPlaceholder);
    return true;
  };

  switch (type) {
    case 'dropdown': {
      const items = listItemsOf(control);
      const item = items.find((candidate) => candidate.value === value);
      if (!item) return { ok: false, reason: 'invalidArgs' };
      nextControl = withUpdatedProperties(nextControl, (properties) => {
        const list = sdtPrChild(properties, 'dropDownList');
        if (!list) return clearShowingPlaceholder(properties);
        const children: readonly OoxmlNode[] = properties.children;
        return withChildren(
          clearShowingPlaceholder(properties),
          children.map((child) => (child.id === list.id ? setLastValueOnList(list, value) : child)),
          null
        );
      });
      if (!setTextContent(item.displayText)) return { ok: false, reason: 'unsupported' };
      break;
    }
    case 'combo': {
      const items = listItemsOf(control);
      const item = items.find((candidate) => candidate.value === value);
      const display = item?.displayText ?? value;
      nextControl = withUpdatedProperties(nextControl, (properties) => {
        const list = sdtPrChild(properties, 'comboBox');
        if (!list) return clearShowingPlaceholder(properties);
        const children: readonly OoxmlNode[] = properties.children;
        return withChildren(
          clearShowingPlaceholder(properties),
          children.map((child) => (child.id === list.id ? setLastValueOnList(list, value) : child)),
          null
        );
      });
      if (!setTextContent(display)) return { ok: false, reason: 'unsupported' };
      break;
    }
    case 'checkbox': {
      const checked = parseCheckboxValue(value);
      if (checked === null) return { ok: false, reason: 'typeMismatch' };
      const payload = checkboxPayloadOf(control);
      if (!payload) return { ok: false, reason: 'typeMismatch' };
      nextControl = withUpdatedProperties(nextControl, (properties) => {
        const checkbox = sdtPrChild(properties, 'checkbox');
        if (!checkbox) return clearShowingPlaceholder(properties);
        const checkboxChildren: readonly OoxmlNode[] = checkbox.children;
        const nextCheckbox = withChildren(
          checkbox,
          checkboxChildren.map((child) => {
            if (child.kind === 'textValue' || child.localName !== 'checked') return child;
            const without = child.attributes.filter((attribute) => attribute.localName !== 'val');
            return {
              ...child,
              attributes: [
                ...without,
                {
                  namespaceUri: child.attributes[0]?.namespaceUri ?? W14_NAMESPACE_URI,
                  prefix: child.attributes[0]?.prefix ?? 'w14',
                  localName: 'val',
                  value: checked ? '1' : '0',
                },
              ],
            } as OoxmlNode;
          }),
          null
        );
        // Ensure a checked child exists.
        const nextCheckboxChildren: readonly OoxmlNode[] =
          nextCheckbox.kind === 'textValue' ? [] : nextCheckbox.children;
        const hasChecked = nextCheckboxChildren.some(
          (child) => child.kind !== 'textValue' && child.localName === 'checked'
        );
        const withChecked = hasChecked
          ? nextCheckbox
          : withChildren(
              checkbox,
              [
                {
                  id: nextId(),
                  kind: 'generic',
                  namespaceUri: W14_NAMESPACE_URI,
                  localName: 'checked',
                  prefix: 'w14',
                  namespaceBindings: [],
                  attributes: [
                    {
                      namespaceUri: W14_NAMESPACE_URI,
                      prefix: 'w14',
                      localName: 'val',
                      value: checked ? '1' : '0',
                    },
                  ],
                  children: [],
                } as unknown as OoxmlNode,
                ...checkboxChildren,
              ],
              null
            );
        const propertiesChildren: readonly OoxmlNode[] = properties.children;
        return withChildren(
          clearShowingPlaceholder(properties),
          propertiesChildren.map((child) =>
            child.id === checkbox.id ? (hasChecked ? nextCheckbox : withChecked) : child
          ),
          null
        );
      });
      const glyph = checked ? payload.checkedGlyph : payload.uncheckedGlyph;
      const font = checked ? payload.checkedFont : payload.uncheckedFont;
      // A state that names no code point cannot be written either way, as the typed path says.
      const text = decodeCheckboxGlyph(glyph);
      if (text === null) return { ok: false, reason: 'invalidArgs' };
      const children = checkboxContent(
        contentControlContentOf(nextControl),
        { hex: glyph, font, states: [payload.checkedGlyph, payload.uncheckedGlyph] },
        text,
        nextId,
        isInlineControl(part, control.id)
      );
      if (!children) return { ok: false, reason: 'unsupported' };
      nextControl = replaceControlContent(nextControl, children, nextId);
      nextControl = withUpdatedProperties(nextControl, clearShowingPlaceholder);
      break;
    }
    case 'date': {
      const properties = contentControlPropertiesOf(control);
      const date = sdtPrChild(properties, 'date');
      const format = attributeValueOf(sdtPrChild(date, 'dateFormat'), 'val');
      const iso = normalizeSdtFullDate(value);
      const display = iso ? formatSdtDateDisplay(iso, format) : null;
      if (iso === null || display === null) return { ok: false, reason: 'invalidArgs' };
      nextControl = withUpdatedProperties(nextControl, (props) => {
        const dateNode = sdtPrChild(props, 'date');
        if (!dateNode) return clearShowingPlaceholder(props);
        const without = dateNode.attributes.filter(
          (attribute) => attribute.localName !== 'fullDate'
        );
        const nextDate = {
          ...dateNode,
          attributes: [
            ...without,
            {
              namespaceUri: WML_NAMESPACE_URI,
              prefix: 'w',
              localName: 'fullDate',
              value: iso,
            },
          ],
        } as OoxmlNode;
        const propsChildren: readonly OoxmlNode[] = props.children;
        return withChildren(
          clearShowingPlaceholder(props),
          propsChildren.map((child) => (child.id === dateNode.id ? nextDate : child)),
          null
        );
      });
      if (!setTextContent(display)) return { ok: false, reason: 'unsupported' };
      break;
    }
    case 'text':
    case 'richText':
    case 'other':
      if (!setTextContent(value)) return { ok: false, reason: 'unsupported' };
      break;
    default:
      return { ok: false, reason: 'unsupported' };
  }

  // Paragraphs the value dropped, minted or kept in place are reported, so paragraph-keyed
  // consumers never hold an entry for a paragraph that went or miss one that changed.
  const effect = withParagraphDiff(
    {
      dirty: owner ? [owner.id] : [control.id],
      created: [],
      deleted: [],
      dependencyKeys: TEXT_DEPS,
      impact: 'flow-structural',
    },
    control,
    nextControl
  );

  if (isTemporaryControl(control)) {
    // Value write + temporary unwrap in one parent rewrite.
    if (!owner) return { ok: false, reason: 'tree-invariant' };
    const kept = contentControlUnwrapPayload(nextControl);
    if (!kept) return { ok: false, reason: 'tree-invariant' };
    const children = owner.children.flatMap((child) => (child.id === control.id ? kept : [child]));
    return fromEdit(replaceChildren(part, owner.id, children, options), effect);
  }

  return fromEdit(replaceNode(part, control.id, nextControl, options), effect);
}

function splitIdentityOf(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode
): { readonly headId: string; readonly prefix: string } | null {
  const headParaId = paraIdOf(paragraph);
  if (headParaId === null || !isValidParaId(headParaId)) return null;
  const prefix = w14PrefixInScopeAt(part, paragraph);
  if (prefix === null) return null;
  return { headId: headParaId.toUpperCase(), prefix };
}

/** Every segment owned by one paragraph child, including atoms that have no run. */
export function segmentsForChild(child: OoxmlNode, segments: readonly Segment[]): Segment[] {
  const descendantIds = new Set<string>();
  const collect = (node: OoxmlNode): void => {
    descendantIds.add(node.id);
    if (node.kind === 'textValue') return;
    for (const inner of node.children) collect(inner);
  };
  collect(child);
  return segments.filter((segment) => descendantIds.has(segmentAncestryNodeId(segment)));
}

/**
 * Divide ONE inline paragraph child that straddles a split point.
 *
 * A run divides by content: its children go left or right of the offset, and a `w:t` sitting
 * across it is cut in two, with `w:rPr` duplicated onto both halves so formatting survives.
 *
 * A HYPERLINK divides by recursion, and the result is TWO hyperlinks carrying the same
 * authored attributes — the same target, tooltip and history on each half. That is what Word
 * writes when Enter lands inside a link, and the alternative (sending the whole link to one
 * side) either drags text backwards out of the sentence it belongs to or carries it forward
 * into a paragraph the user meant to be empty. Either half may come back empty, in which case
 * only the other is emitted; an empty `w:hyperlink` is markup with nothing to click.
 */
function divideInline(
  child: OoxmlNode,
  offset: number,
  segments: readonly Segment[],
  nextId: () => string,
  depth = 0
): { readonly head: OoxmlNode | null; readonly tail: OoxmlNode | null } {
  if (depth >= MAX_INLINE_CONTAINER_DEPTH) return { head: child, tail: null };
  // A REVISION WRAPPER SPLITS LIKE A HYPERLINK. `w:ins` and `w:del` are containers of run
  // content, not run content, so the "not a run, keep it whole" answer below put an entire
  // tracked insertion into the HEAD half however far into it the caret was: pressing Enter in
  // the middle of somebody's suggested sentence broke the paragraph after the suggestion
  // instead of at the caret, and said nothing. Both halves keep the same author, date and id,
  // which is how a reader groups them back into one decision.
  if (isInlineRunContainer(child) || isContentControlNode(child)) {
    // Exclude textValue so both the wrapper and its content owner expose `.children`.
    if (child.kind === 'textValue') return { head: child, tail: null };
    const contentOwner = isContentControlNode(child) ? contentControlContentOf(child) : child;
    if (!contentOwner) return { head: child, tail: null };
    const headChildren: OoxmlNode[] = [];
    const tailChildren: OoxmlNode[] = [];
    // Where the walk has reached inside this wrapper, so zero-length content between two
    // runs takes the side its POSITION puts it on — the same rule the paragraph walk
    // applies.
    //
    // Seeded from the WRAPPER'S OWN START, not 0. These are absolute paragraph offsets, and
    // starting at zero said "before every boundary" for content that sits well past one.
    let cursor = segmentsForChild(child, segments)[0]?.start ?? 0;
    const ownerChildren: readonly OoxmlNode[] = contentOwner.children;
    const properties = inlineWrapperProperties(child);
    for (const inner of ownerChildren) {
      if (properties.some((property) => property.id === inner.id)) continue;
      const innerSegments = segmentsForChild(inner, segments);
      if (innerSegments.length === 0) {
        (cursor < offset ? headChildren : tailChildren).push(inner);
        continue;
      }
      const start = innerSegments[0]!.start;
      const end = innerSegments[innerSegments.length - 1]!.end;
      cursor = end;
      if (end <= offset) headChildren.push(inner);
      else if (start >= offset) tailChildren.push(inner);
      else {
        const divided = divideInline(inner, offset, segments, nextId, depth + 1);
        if (divided.head) headChildren.push(divided.head);
        if (divided.tail) tailChildren.push(divided.tail);
      }
    }
    if (isInlineRunContainer(child)) {
      return {
        head:
          headChildren.length > 0
            ? withChildren(child, wrapperChildren(properties, headChildren, false, nextId), null)
            : null,
        tail:
          tailChildren.length > 0
            ? withChildren(child, wrapperChildren(properties, tailChildren, true, nextId), nextId)
            : null,
      };
    }
    // Content control: keep sdtPr / sdtEndPr on both halves; only sdtContent splits.
    const controlChildren: readonly OoxmlNode[] = child.children;
    const rebuild = (contentChildren: readonly OoxmlNode[], mintId: boolean): OoxmlNode => {
      const nextContent = withChildren(contentOwner, contentChildren, mintId ? nextId : null);
      if (!mintId) {
        return withChildren(
          child,
          controlChildren.map((grand) => (grand.id === contentOwner.id ? nextContent : grand)),
          null
        );
      }
      return withChildren(
        child,
        controlChildren.map((grand) => {
          if (grand.id === contentOwner.id) return nextContent;
          return cloneWithNewIds(grand, nextId);
        }),
        nextId
      );
    };
    return {
      head: headChildren.length > 0 ? rebuild(headChildren, false) : null,
      tail: tailChildren.length > 0 ? rebuild(tailChildren, true) : null,
    };
  }

  if (child.kind !== 'run') return { head: child, tail: null };

  const runSegments = segments.filter((segment) => segment.runId === child.id);
  const rPr = runPropertiesNodeOf(child);
  const headContent: OoxmlNode[] = [];
  const tailContent: OoxmlNode[] = [];
  for (const grand of child.children) {
    if (isRunPropertiesNode(grand)) continue;
    const segment = runSegments.find((candidate) => contains(grand, candidate.node.id));
    if (!segment) {
      headContent.push(grand);
      continue;
    }
    if (segment.end <= offset) headContent.push(grand);
    else if (segment.start >= offset) tailContent.push(grand);
    else if (segment.node.kind === 'textValue') {
      const local = offset - segment.start;
      const splitKind = textKindOfValue(child, segment.node.id);
      headContent.push(textElement(nextId, segment.node.value.slice(0, local), splitKind));
      tailContent.push(textElement(nextId, segment.node.value.slice(local), splitKind));
    } else headContent.push(grand);
  }
  const clonedRpr = rPr ? cloneWithNewIds(rPr, nextId) : null;
  return {
    head:
      headContent.length > 0 ? runElement(nextId, rPr ? [rPr, ...headContent] : headContent) : null,
    tail:
      tailContent.length > 0
        ? runElement(nextId, clonedRpr ? [clonedRpr, ...tailContent] : tailContent)
        : null,
  };
}

/**
 * The same element with different children — retaining the original identity, or minting a
 * fresh one for the copy a split leaves on the other side of the break.
 */
function withChildren(
  node: OoxmlNode,
  children: readonly OoxmlNode[],
  nextId: (() => string) | null
): OoxmlNode {
  return { ...node, ...(nextId ? { id: nextId() } : {}), children } as OoxmlNode;
}

function applySplit(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  options?: EditOptions,
  tailStyleId?: string | null
): TreeOpResult {
  const nextId = createNodeIdAllocator(part);
  const { children, segments, endIds } = fieldSplitChildren(paragraph, [offset], nextId);
  const headChildren: OoxmlNode[] = [];
  const tailChildren: OoxmlNode[] = [];
  const pPr = paragraphPropertiesNodeOf(paragraph);

  // The running text offset the walk has reached, which is the position of anything that
  // measures nothing.
  let cursor = 0;
  // The range starts seen AT the current position — the ones whose end markers, if they
  // also sit here, must not be left behind in the head.
  const openedHere = new Set<string>();
  for (const child of children) {
    if (isParagraphPropertiesNode(child)) continue;
    const runSegments = segmentsForChild(child, segments);
    if (runSegments.length === 0) {
      ([...endIds].some((id) => contains(child, id)) ||
      zeroLengthGoesToHead(child, cursor, offset, openedHere)
        ? headChildren
        : tailChildren
      ).push(child);
      const opened = opensARange(child);
      if (opened) openedHere.add(opened);
      continue;
    }
    const runStart = runSegments[0]!.start;
    const runEnd = runSegments[runSegments.length - 1]!.end;
    if (runEnd > cursor) openedHere.clear();
    cursor = runEnd;
    if (runEnd <= offset) {
      headChildren.push(child);
      continue;
    }
    if (runStart >= offset) {
      tailChildren.push(child);
      continue;
    }
    const divided = divideInline(child, offset, segments, nextId);
    if (divided.head) headChildren.push(divided.head);
    if (divided.tail) tailChildren.push(divided.tail);
  }

  // A `w:sectPr` in the split paragraph's mark belongs to the TAIL: Word splits by
  // inserting a fresh mark before the existing one, so the original mark — and the
  // section boundary it carries — stays after ALL the paragraph's content. Cloning it
  // onto both halves minted a phantom section (and a spurious page break) on every
  // Enter in a section's last paragraph. The mark's own revisions stay on the tail too
  // (`tree-op-split-mark.ts`).
  const headPPr = pPr ? withoutOriginalMark(pPr) : undefined;
  // The HEAD keeps the original paragraph's `w14:paraId` (it is spread below); the tail
  // is the new paragraph and gets a fresh deterministic mint, exactly as Word assigns a
  // new id to the paragraph an Enter creates. Seeded by (head id, offset) so one
  // `splitParagraphMany` and its equivalent sequence of single splits mint identically.
  const identity = splitIdentityOf(part, paragraph);
  const tailParagraph = {
    id: nextId(),
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    prefix: 'w',
    namespaceBindings: [],
    attributes: identity
      ? mintedParagraphIdentityAttributes(
          identity.prefix,
          mintParaId(actorScopedSeed(`${identity.headId}:${offset}`), usedParaIds(part.root))
        )
      : [],
    children: (() => {
      const tailPPr = withTailStyle(pPr, tailStyleId, nextId);
      return tailPPr ? [tailPPr, ...tailChildren] : tailChildren;
    })(),
  } as unknown as OoxmlNode;

  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [tailParagraph.id],
    deleted: [],
    split: { from: paragraph.id, tail: tailParagraph.id },
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };

  // A single edit against the parent's child sequence. Expressed as "replace the head
  // `w:p`'s children, then insert the tail `w:p`", every split produced two intermediate
  // trees — and two node-index states — and a plain-text paste performs one split per
  // paragraph mark. Substituting [head, tail] for the original `w:p` yields the identical
  // tree in one rebuild.
  const parent = parentOf(part, paragraph.id);
  if (!parent) return { ok: false, reason: 'tree-invariant', detail: 'paragraph has no parent' };
  const headParagraph = Object.freeze({
    ...paragraph,
    children: headPPr ? [headPPr, ...headChildren] : headChildren,
  }) as OoxmlNode;
  const siblings = parent.children.flatMap((child) =>
    child.id === paragraph.id ? [headParagraph, tailParagraph] : [child]
  );
  return fromEdit(replaceChildren(part, parent.id, siblings, options), effect);
}

/** The resulting paragraph a source offset belongs to: how many boundaries lie at or before it. */
function pieceIndexOf(
  offsets: readonly number[],
  position: number,
  atBoundary: 'tail' | 'head' = 'tail'
): number {
  // Binary search — a whole-document paste can carry thousands of boundaries, and every
  // segment asks. Content sitting exactly ON a boundary opens that boundary's tail, which
  // is what the equivalent sequence of single splits does; `head` is for the range-end
  // markers the single split keeps behind, so a range that closed at the caret stays closed.
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const before = atBoundary === 'tail' ? offsets[mid]! <= position : offsets[mid]! < position;
    if (before) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Spread ONE inline paragraph child that straddles at least one of `offsets` across the
 * resulting pieces, in piece order.
 *
 * The many-way twin of {@link divideInline}: a run divides its content by boundary, keeping
 * `w:rPr` on every piece it lands in, and a hyperlink recurses and re-wraps each piece's
 * share in a copy of itself so every fragment of a link stays a link with the same target.
 * The original identity is kept by the FIRST piece that gets content; later pieces are
 * clones, matching what the equivalent sequence of single splits produces.
 */
export function distributeInline(
  child: OoxmlNode,
  offsets: readonly number[],
  pieceCount: number,
  segments: readonly Segment[],
  nextId: () => string,
  depth = 0
): OoxmlNode[][] {
  const byPiece: OoxmlNode[][] = Array.from({ length: pieceCount }, () => []);
  if (depth >= MAX_INLINE_CONTAINER_DEPTH) {
    const start = segmentsForChild(child, segments)[0]?.start ?? 0;
    byPiece[pieceIndexOf(offsets, start)]!.push(child);
    return byPiece;
  }

  // A REVISION WRAPPER DISTRIBUTES LIKE A HYPERLINK, the same rule `divideInline` states:
  // `w:ins` and `w:del` are containers of run content, not run content, so the "not a run,
  // keep it whole" answer below put an entire tracked insertion into the FIRST piece however
  // many boundaries ran through it — a multi-line paste in suggesting mode kept its lines in
  // one paragraph and minted empty tails. Every piece keeps the same author, date and id,
  // which is how a reader groups them back into one decision.
  if (isInlineRunContainer(child)) {
    const innerByPiece: OoxmlNode[][] = Array.from({ length: pieceCount }, () => []);
    const properties = inlineWrapperProperties(child);
    // Absolute paragraph offsets, seeded from the link's own start — see `divideInline`.
    // At zero, `pieceIndexOf` put every zero-length child of a link in the FIRST piece: a
    // bookmark travelled to a paragraph its text did not, an empty `w:hyperlink` husk was
    // emitted (which this file's own rule forbids), and the husk kept the original node id
    // while the real link got a fresh one — so a later retarget addressed the husk.
    let cursor = segmentsForChild(child, segments)[0]?.start ?? 0;
    for (const inner of child.children) {
      if (properties.some((property) => property.id === inner.id)) continue;
      const innerSegments = segmentsForChild(inner, segments);
      if (innerSegments.length === 0) {
        innerByPiece[pieceIndexOf(offsets, cursor)]!.push(inner);
        continue;
      }
      const start = innerSegments[0]!.start;
      const end = innerSegments[innerSegments.length - 1]!.end;
      cursor = end;
      const startPiece = pieceIndexOf(offsets, start);
      const endPiece = end > start ? pieceIndexOf(offsets, end - 1) : startPiece;
      if (startPiece === endPiece) {
        innerByPiece[startPiece]!.push(inner);
        continue;
      }
      const nested = distributeInline(inner, offsets, pieceCount, segments, nextId, depth + 1);
      for (let piece = 0; piece < pieceCount; piece += 1) {
        for (const node of nested[piece]!) innerByPiece[piece]!.push(node);
      }
    }
    let keptOriginal = false;
    for (let piece = 0; piece < pieceCount; piece += 1) {
      const children = innerByPiece[piece]!;
      if (children.length === 0) continue;
      byPiece[piece]!.push(
        withChildren(
          child,
          wrapperChildren(properties, children, keptOriginal, nextId),
          keptOriginal ? nextId : null
        )
      );
      keptOriginal = true;
    }
    return byPiece;
  }

  if (isContentControlNode(child)) {
    if (child.kind === 'textValue') {
      byPiece[0]!.push(child);
      return byPiece;
    }
    const content = contentControlContentOf(child);
    if (!content) {
      byPiece[0]!.push(child);
      return byPiece;
    }
    const controlChildren: readonly OoxmlNode[] = child.children;
    const contentChildren: readonly OoxmlNode[] = content.children;
    const innerByPiece: OoxmlNode[][] = Array.from({ length: pieceCount }, () => []);
    let cursor = segmentsForChild(child, segments)[0]?.start ?? 0;
    for (const inner of contentChildren) {
      const innerSegments = segmentsForChild(inner, segments);
      if (innerSegments.length === 0) {
        innerByPiece[pieceIndexOf(offsets, cursor)]!.push(inner);
        continue;
      }
      const start = innerSegments[0]!.start;
      const end = innerSegments[innerSegments.length - 1]!.end;
      cursor = end;
      const startPiece = pieceIndexOf(offsets, start);
      const endPiece = end > start ? pieceIndexOf(offsets, end - 1) : startPiece;
      if (startPiece === endPiece) {
        innerByPiece[startPiece]!.push(inner);
        continue;
      }
      const nested = distributeInline(inner, offsets, pieceCount, segments, nextId, depth + 1);
      for (let piece = 0; piece < pieceCount; piece += 1) {
        for (const node of nested[piece]!) innerByPiece[piece]!.push(node);
      }
    }
    let keptOriginal = false;
    for (let piece = 0; piece < pieceCount; piece += 1) {
      const children = innerByPiece[piece]!;
      if (children.length === 0) continue;
      const nextContent = withChildren(content, children, keptOriginal ? nextId : null);
      if (!keptOriginal) {
        byPiece[piece]!.push(
          withChildren(
            child,
            controlChildren.map((grand) => (grand.id === content.id ? nextContent : grand)),
            null
          )
        );
      } else {
        byPiece[piece]!.push(
          withChildren(
            child,
            controlChildren.map((grand) => {
              if (grand.id === content.id) return nextContent;
              return cloneWithNewIds(grand, nextId);
            }),
            nextId
          )
        );
      }
      keptOriginal = true;
    }
    return byPiece;
  }

  if (child.kind !== 'run') {
    byPiece[pieceIndexOf(offsets, 0)]!.push(child);
    return byPiece;
  }

  const runSegments = segments.filter((segment) => segment.runId === child.id);
  const startPiece = pieceIndexOf(offsets, runSegments[0]?.start ?? 0);
  const rPr = runPropertiesNodeOf(child);
  const contentByPiece: OoxmlNode[][] = Array.from({ length: pieceCount }, () => []);
  for (const grand of child.children) {
    if (isRunPropertiesNode(grand)) continue;
    const segment = runSegments.find((candidate) => contains(grand, candidate.node.id));
    if (!segment) {
      contentByPiece[startPiece]!.push(grand);
      continue;
    }
    if (segment.node.kind !== 'textValue') {
      contentByPiece[pieceIndexOf(offsets, segment.start)]!.push(grand);
      continue;
    }
    const from = segment.start;
    const until = segment.end;
    let sliceStart = from;
    let piece = pieceIndexOf(offsets, from);
    let cut = false;
    // The element the value hangs off, so a split inside a `w:del` keeps writing `w:delText`.
    const segmentOwner = grand;
    for (const boundary of offsets) {
      if (boundary <= from) continue;
      if (boundary >= until) break;
      // A REPEATED boundary yields an empty slice: the piece between two equal offsets
      // is an empty paragraph, and an empty `w:t` inside it would serialize markup the
      // equivalent single splits never produce — so the piece advances and nothing is
      // emitted, exactly as a split at a paragraph edge emits no text.
      const slice = segment.node.value.slice(sliceStart - from, boundary - from);
      if (slice.length > 0) {
        contentByPiece[piece]!.push(
          textElement(nextId, slice, textKindOfValue(segmentOwner, segment.node.id))
        );
      }
      sliceStart = boundary;
      piece += 1;
      cut = true;
    }
    if (!cut) {
      // No boundary inside this value: it moves whole, identity intact.
      contentByPiece[piece]!.push(grand);
      continue;
    }
    const lastSlice = segment.node.value.slice(sliceStart - from);
    if (lastSlice.length > 0) {
      contentByPiece[piece]!.push(
        textElement(nextId, lastSlice, textKindOfValue(segmentOwner, segment.node.id))
      );
    }
  }
  let keptOriginalRpr = false;
  for (let piece = 0; piece < pieceCount; piece += 1) {
    const content = contentByPiece[piece]!;
    if (content.length === 0) continue;
    const pieceRpr = rPr ? (keptOriginalRpr ? cloneWithNewIds(rPr, nextId) : rPr) : null;
    keptOriginalRpr = true;
    byPiece[piece]!.push(runElement(nextId, pieceRpr ? [pieceRpr, ...content] : content));
  }
  return byPiece;
}

/**
 * Split a `w:p` at every offset in one pass.
 *
 * Semantically the sequence of single splits from the last offset to the first, produced
 * without the intermediates: each character of the paragraph's content is visited once,
 * and the parent's child sequence is rebuilt once. Runs and text values wholly inside one
 * resulting paragraph keep their identity, exactly as an untouched run survives a single
 * split; only content straddling a boundary is rebuilt. `w:pPr` and `w:rPr` are duplicated
 * onto every tail with fresh identities, so direct formatting survives the break the way
 * Word carries it across a paragraph mark.
 */
function applySplitMany(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offsets: readonly number[],
  options?: EditOptions
): TreeOpResult {
  const nextId = createNodeIdAllocator(part);
  const { children, segments, endIds } = fieldSplitChildren(paragraph, offsets, nextId);
  const pPr = paragraphPropertiesNodeOf(paragraph);
  const pieceCount = offsets.length + 1;
  const pieces: OoxmlNode[][] = Array.from({ length: pieceCount }, () => []);

  // The running text offset the walk has reached — the position of anything measuring
  // nothing, exactly as the single split reads it.
  let cursor = 0;
  const openedHere = new Set<string>();
  for (const child of children) {
    if (isParagraphPropertiesNode(child)) continue;
    const runSegments = segmentsForChild(child, segments);
    if (runSegments.length === 0) {
      const piece = pieceIndexOf(
        offsets,
        cursor,
        [...endIds].some((id) => contains(child, id)) || closesAnOpenRange(child, openedHere)
          ? 'head'
          : 'tail'
      );
      pieces[piece]!.push(child);
      const opened = opensARange(child);
      if (opened) openedHere.add(opened);
      continue;
    }
    const runStart = runSegments[0]!.start;
    const runEnd = runSegments[runSegments.length - 1]!.end;
    if (runEnd > cursor) openedHere.clear();
    cursor = runEnd;
    const startPiece = pieceIndexOf(offsets, runStart);
    const endPiece = runEnd > runStart ? pieceIndexOf(offsets, runEnd - 1) : startPiece;
    if (startPiece === endPiece) {
      // Wholly inside one resulting paragraph: the child survives with its identity.
      pieces[startPiece]!.push(child);
      continue;
    }
    const distributed = distributeInline(child, offsets, pieceCount, segments, nextId);
    for (let piece = 0; piece < pieceCount; piece += 1) {
      for (const node of distributed[piece]!) pieces[piece]!.push(node);
    }
  }

  // A `w:sectPr` in the mark belongs to the LAST piece only — the original mark ends up
  // after all the paragraph's content, exactly as the single-split rule keeps it on the
  // tail. Duplicating it minted one phantom section per pasted line. The mark's own
  // revisions stay on the last piece for the same reason (`tree-op-split-mark.ts`).
  const strippedPPr = pPr ? withoutOriginalMark(pPr) : undefined;
  // Tail `w14:paraId`s, minted in DESCENDING piece order: the equivalent sequence of
  // single splits runs last-offset-first, so its used-set grows from the last tail
  // backwards. Mirroring that order (including how a repeated offset's seed collision
  // bumps) keeps `splitParagraphMany` byte-identical to the singles it stands for.
  const identity = splitIdentityOf(part, paragraph);
  const tailIdentityAttributes: (readonly OoxmlAttribute[] | null)[] = Array.from(
    { length: pieceCount },
    () => null
  );
  if (identity) {
    const used = new Set(usedParaIds(part.root));
    for (let piece = pieceCount - 1; piece >= 1; piece -= 1) {
      const value = mintParaId(actorScopedSeed(`${identity.headId}:${offsets[piece - 1]!}`), used);
      used.add(value);
      tailIdentityAttributes[piece] = mintedParagraphIdentityAttributes(identity.prefix, value);
    }
  }
  const tailParagraphs: OoxmlNode[] = [];
  for (let piece = 1; piece < pieceCount; piece += 1) {
    const last = piece === pieceCount - 1;
    const source = last ? pPr : strippedPPr;
    tailParagraphs.push({
      id: nextId(),
      kind: 'paragraph',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'p',
      prefix: 'w',
      namespaceBindings: [],
      attributes: tailIdentityAttributes[piece] ?? [],
      children: source ? [cloneWithNewIds(source, nextId), ...pieces[piece]!] : pieces[piece]!,
    } as unknown as OoxmlNode);
  }

  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: tailParagraphs.map((tail) => tail.id),
    deleted: [],
    splits: tailParagraphs.map((tail) => ({ from: paragraph.id, tail: tail.id })),
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };

  const parent = parentOf(part, paragraph.id);
  if (!parent) return { ok: false, reason: 'tree-invariant', detail: 'paragraph has no parent' };
  const headParagraph = Object.freeze({
    ...paragraph,
    children: strippedPPr ? [strippedPPr, ...pieces[0]!] : pieces[0]!,
  }) as OoxmlNode;
  const siblings = parent.children.flatMap((child) =>
    child.id === paragraph.id ? [headParagraph, ...tailParagraphs] : [child]
  );
  return fromEdit(replaceChildren(part, parent.id, siblings, options), effect);
}

/**
 * Take a whole block out of the tree.
 *
 * All of the thinking is in validation — which containers a removal may not empty, which
 * kinds are removable at all — so the application is the `removeNode` primitive plus an
 * honest effect. `deleted` names the block AND every paragraph that went with it: a
 * consumer scoping work by node id has to invalidate the paragraphs, and the block id alone
 * would leave a layout cache holding entries for paragraphs that no longer exist.
 */
function emptyCellParagraph(
  part: OoxmlPart,
  anchorTable: OoxmlElement,
  nextId: () => string,
  seed: string
): OoxmlParagraphNode {
  const wml = wmlFreshNamespaceContextAt(part, anchorTable);
  const used = usedParaIds(part.root);
  const identity: OoxmlAttribute[] = [];
  const w14Prefix = w14PrefixInScopeAt(part, anchorTable);
  if (w14Prefix !== null) {
    const paraIdValue = mintParaId(actorScopedSeed(seed), used);
    identity.push(...mintedParagraphIdentityAttributes(w14Prefix, paraIdValue));
  }
  return {
    id: nextId(),
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    ...(wml.elementPrefix === undefined ? {} : { prefix: wml.elementPrefix }),
    namespaceBindings: [],
    attributes: identity,
    children: [],
  } as OoxmlParagraphNode;
}

function applyDeleteBlock(part: OoxmlPart, blockId: string, options?: EditOptions): TreeOpResult {
  const block = findNode(part, blockId);
  if (!block) return { ok: false, reason: 'unknown-block' };
  const caret = caretAfterBlockRemoval(part, blockId);
  if (!caret) return { ok: false, reason: 'block-required' };
  const parent = parentOf(part, blockId);
  const cellNeedsParagraph =
    block.kind === 'table' &&
    parent?.kind === 'tableCell' &&
    parent.children.every((child) => child.kind !== 'paragraph');
  const paragraphs = paragraphIdsWithin(block);
  const created: string[] = [];
  const effect: TreeOpEffect = {
    dirty: [],
    created,
    deleted: [blockId, ...paragraphs.filter((id) => id !== blockId)],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
    caret,
  };
  const repairs = block.kind === 'tableRow' ? planVerticalMergeHeadRepairs(part, blockId) : null;
  if (repairs && !repairs.ok) return { ok: false, reason: repairs.reason };
  if (repairs?.ok && repairs.repairs.length > 0) {
    // A row taking a merge's `restart` cell with it hands the merge to the row below.
    const edits = rowRemovalEdits(repairs.repairs, blockId, options);
    const dirty = verticalMergeHeadRepairDirtyIds(repairs.repairs);
    return fromEdit(applyEdits(part, edits, options), { ...effect, dirty });
  }
  const removed = removeNode(part, blockId, options);
  if (!removed.ok) return { ok: false, reason: 'unknown-block' };
  if (!cellNeedsParagraph || !parent) return fromEdit(removed, effect);
  const anchorTable = tableAncestorOf(removed.part, parent.id);
  if (!anchorTable) return fromEdit(removed, effect);
  const nextId = createNodeIdAllocator(removed.part);
  const paragraph = emptyCellParagraph(removed.part, anchorTable, nextId, `${blockId}:cell-p`);
  const cell = findNode(removed.part, parent.id);
  if (!cell || cell.kind === 'textValue') return fromEdit(removed, effect);
  const inserted = insertChildren(
    removed.part,
    parent.id,
    cell.children.length,
    [paragraph],
    options
  );
  if (!inserted.ok) return { ok: false, reason: 'tree-invariant' };
  return fromEdit(inserted, { ...effect, created: [...created, paragraph.id] });
}

function applyJoin(
  part: OoxmlPart,
  firstId: string,
  secondId: string,
  options?: EditOptions
): TreeOpResult {
  const second = findNode(part, secondId) as OoxmlParagraphNode;
  const parent = parentOf(part, firstId);
  const secondParent = parentOf(part, secondId);
  if (!parent || !secondParent || parent.id !== secondParent.id) {
    return { ok: false, reason: 'not-adjacent-siblings' };
  }
  const firstIndex = parent.children.findIndex((child) => child.id === firstId);
  const secondIndex = parent.children.findIndex((child) => child.id === secondId);
  if (secondIndex !== firstIndex + 1) return { ok: false, reason: 'not-adjacent-siblings' };

  // Capture before the join: a temporary enclosing either paragraph must unwrap in the
  // same write (join is a successful content edit). Validation already refused wrapper locks.
  const temporaryControls: OoxmlNode[] = [];
  const seenTemporary = new Set<string>();
  for (const paragraphId of [firstId, secondId]) {
    const control = innermostContentControlAround(part, paragraphId);
    if (control && isTemporaryControl(control) && !seenTemporary.has(control.id)) {
      seenTemporary.add(control.id);
      temporaryControls.push(control);
    }
  }

  const effect: TreeOpEffect = {
    dirty: [firstId],
    created: [],
    deleted: [secondId],
    join: { kept: firstId, removed: secondId },
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };

  // The survivor keeps ITS paragraph properties; the removed paragraph's are dropped, which
  // matches Word: joining into a paragraph adopts that paragraph's formatting.
  const moved = second.children.filter((child) => !isParagraphPropertiesNode(child));

  // A single edit against the shared parent: the surviving `w:p` receives the second
  // paragraph's content children, and the second `w:p` leaves the child sequence, in the
  // same rebuild. Expressed as remove-then-reparent the join produced two intermediate
  // trees per op; a single rebuild has no intermediate state at all, so the moved runs are
  // never under two parents at any point.
  const first = parent.children.find((child) => child.id === firstId);
  if (!first || first.kind !== 'paragraph') {
    return { ok: false, reason: 'tree-invariant', detail: 'survivor missing' };
  }
  const nextId = createNodeIdAllocator(part);
  const kept = withSectionMarkOf(first, second, nextId);
  const merged = Object.freeze({ ...kept, children: [...kept.children, ...moved] }) as OoxmlNode;
  const siblings = parent.children.flatMap((child) =>
    child.id === firstId ? [merged] : child.id === secondId ? [] : [child]
  );
  const defer = temporaryControls.length > 0 ? { ...options, deferValidation: true } : options;
  let result = fromEdit(replaceChildren(part, parent.id, siblings, defer), effect);
  for (const control of temporaryControls) {
    result = finishContentEdit(result, control, options);
  }
  return result;
}

/**
 * The join survivor, carrying the TRACKED STATE of the mark that survives.
 *
 * A join deletes the FIRST paragraph's mark, so the mark the merged paragraph ends with is
 * the SECOND's — and two things ride on a mark rather than on formatting. `w:sectPr` says
 * where a section ENDS (§17.6.17); dropping it merged the section into the one that follows,
 * taking that section's page size, orientation and headers over every page of it. The mark's
 * own `w:ins`/`w:del` says the break itself is a pending decision; keeping the FIRST
 * paragraph's left the survivor proposing to delete a break the user had just deleted, so the
 * next layout pass merged it into the paragraph after it and the review pane kept a card for
 * a mark that no longer exists.
 *
 * Formatting is the other way round, and stays as it was: the survivor keeps its own
 * properties, which is what Word does when you join into a paragraph.
 */
function withSectionMarkOf(
  first: OoxmlNode & { readonly children: readonly OoxmlNode[] },
  second: OoxmlParagraphNode,
  nextId: () => string
): OoxmlNode & { readonly children: readonly OoxmlNode[] } {
  const secondMarkRevisions = (
    namedChild(paragraphPropertiesNodeOf(second), 'rPr')?.children ?? []
  ).filter(isParagraphMarkRevision);
  const survivorHasMarkRevision = (
    namedChild(paragraphPropertiesNodeOf(first), 'rPr')?.children ?? []
  ).some(isParagraphMarkRevision);
  const withMark =
    secondMarkRevisions.length > 0 || survivorHasMarkRevision
      ? withMarkRevisionsOf(first, secondMarkRevisions, nextId)
      : first;
  const sectPr = namedChild(paragraphPropertiesNodeOf(second), 'sectPr');
  if (!sectPr) return withMark;
  // The section properties MOVE, keeping their node ids, like the runs the join moves: a peer
  // that edits them at the same time (a note properties write, a page setup) then edits the
  // node the survivor holds, and the edit is not lost to a copy.
  const carried = sectPr;
  const pPr = paragraphPropertiesNodeOf(withMark);
  if (!pPr) {
    const minted = {
      id: nextId(),
      kind: 'paragraphProperties',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'pPr',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [carried],
    } as unknown as OoxmlNode;
    // `w:pPr` must be the paragraph's FIRST child per the schema.
    return { ...withMark, children: [minted, ...withMark.children] } as OoxmlNode & {
      readonly children: readonly OoxmlNode[];
    };
  }
  // The survivor's own mark, if it had one, goes with the paragraph mark being deleted.
  // `w:sectPr` sits near the END of CT_PPr's sequence, before only `w:pPrChange`.
  const others = pPr.children.filter(
    (child) => child.kind === 'textValue' || child.localName !== 'sectPr'
  );
  const change = others.findIndex(
    (child) => child.kind !== 'textValue' && child.localName === 'pPrChange'
  );
  const at = change === -1 ? others.length : change;
  const rebuilt = {
    ...pPr,
    children: [...others.slice(0, at), carried, ...others.slice(at)],
  } as OoxmlNode;
  return {
    ...withMark,
    children: withMark.children.map((child) => (child.id === pPr.id ? rebuilt : child)),
  } as OoxmlNode & { readonly children: readonly OoxmlNode[] };
}

/**
 * The survivor with the mark revisions of the paragraph whose mark it inherits.
 *
 * Its own go, whatever they were: that mark is the one the join deletes. `EG_ParaRPrTrackChanges`
 * opens `CT_ParaRPr`, so the carried elements go FIRST inside `w:rPr`.
 */
function withMarkRevisionsOf(
  survivor: OoxmlNode & { readonly children: readonly OoxmlNode[] },
  revisions: readonly OoxmlNode[],
  nextId: () => string
): OoxmlNode & { readonly children: readonly OoxmlNode[] } {
  const carried = revisions.map((revision) => cloneWithNewIds(revision, nextId));
  const pPr = paragraphPropertiesNodeOf(survivor);
  if (!pPr) {
    if (carried.length === 0) return survivor;
    const rPr = {
      id: nextId(),
      kind: 'runProperties',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'rPr',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: carried,
    } as unknown as OoxmlNode;
    const minted = {
      id: nextId(),
      kind: 'paragraphProperties',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'pPr',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [rPr],
    } as unknown as OoxmlNode;
    return { ...survivor, children: [minted, ...survivor.children] } as OoxmlNode & {
      readonly children: readonly OoxmlNode[];
    };
  }
  const existingRPr = namedChild(pPr, 'rPr');
  const keptFace = (existingRPr?.children ?? []).filter((child) => !isParagraphMarkRevision(child));
  const rebuiltRPr =
    existingRPr === undefined
      ? carried.length > 0
        ? ({
            id: nextId(),
            kind: 'runProperties',
            namespaceUri: WML_NAMESPACE_URI,
            localName: 'rPr',
            prefix: 'w',
            namespaceBindings: [],
            attributes: [],
            children: carried,
          } as unknown as OoxmlNode)
        : undefined
      : ({ ...existingRPr, children: [...carried, ...keptFace] } as OoxmlNode);
  if (!rebuiltRPr) return survivor;
  // `w:rPr` follows the base properties and precedes `w:sectPr` and `w:pPrChange`.
  const children =
    existingRPr === undefined
      ? (() => {
          const tail = pPr.children.findIndex(
            (child) =>
              child.kind !== 'textValue' &&
              (child.localName === 'sectPr' || child.localName === 'pPrChange')
          );
          const at = tail === -1 ? pPr.children.length : tail;
          return [...pPr.children.slice(0, at), rebuiltRPr, ...pPr.children.slice(at)];
        })()
      : pPr.children.map((child) => (child.id === existingRPr.id ? rebuiltRPr : child));
  const rebuiltPPr = { ...pPr, children } as OoxmlNode;
  return {
    ...survivor,
    children: survivor.children.map((child) => (child.id === pPr.id ? rebuiltPPr : child)),
  } as OoxmlNode & { readonly children: readonly OoxmlNode[] };
}

function applySetRunProperties(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  properties: readonly OoxmlProperty[],
  options?: EditOptions,
  targetRunIds?: readonly string[],
  revision?: RevisionAttributionInput
): TreeOpResult {
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'text-local',
  };
  // Split at both edges first, so the range lands on whole runs and only those runs change.
  // Field atoms keep result runs off the segment map, so splits never touch format targets.
  let current = part;
  for (const boundary of [end, start]) {
    const target = findNode(current, paragraph.id) as OoxmlParagraphNode;
    const split = splitRunsAt(current, target, boundary, options);
    if (!split.ok) return split;
    current = split.part;
  }

  const target = findNode(current, paragraph.id) as OoxmlParagraphNode;
  const segments = segmentsOf(target);
  const runIds = new Set<string>();
  if (targetRunIds && targetRunIds.length > 0) {
    for (const runId of targetRunIds) runIds.add(runId);
  } else {
    for (const segment of segments) {
      if (segment.start < start || segment.end > end) continue;
      if (segment.formatRunIds && segment.formatRunIds.length > 0) {
        for (const runId of segment.formatRunIds) runIds.add(runId);
      } else if (segment.runId) {
        runIds.add(segment.runId);
      }
    }
  }
  const nextId = createNodeIdAllocator(current);
  // ONE id for the whole op, taken LAZILY: `nextRevisionId` walks the part, and a write that
  // records nothing — every run inside this author's own `w:ins` — must not pay it. One id,
  // not one per run, because the op's records are one decision.
  //
  // The TRANSACTION's id is preferred when it lent one, which widens that from the op to the
  // press: formatting emits an op per run, and the walk is document-wide
  // (`EditOptions.revisionIds`).
  let ownId: string | null = null;
  const mintRevisionId = (): string =>
    options?.revisionIds?.() ?? (ownId ??= nextRevisionId(current)());
  for (const runId of runIds) {
    const run = findNode(current, runId);
    if (!run || run.kind !== 'run') continue;
    const existing = runPropertiesNodeOf(run);
    const content = run.children.filter((child) => !isRunPropertiesNode(child));
    const prior = existing?.children ?? [];
    let children: readonly OoxmlNode[] = mergedPropertyChildren(
      prior,
      properties,
      RUN_VOCABULARY,
      nextId
    );
    // A tracked format change keeps the run's NEW properties and records the old ones in a
    // `w:rPrChange`, so Reject restores them. Skipped inside this author's own `w:ins`: the
    // whole run is already their proposal, and rejecting it takes words and formatting
    // together (#495).
    if (revision && !insideOwnInsertion(current, run.id, revision.author)) {
      children = withPropertyChangeRecord({
        container: 'runProperties',
        prior,
        next: children,
        revision,
        mint: nextId,
        nextRevisionId: mintRevisionId,
      });
    }
    if (children.length === 0) {
      if (!existing) continue;
      const cleared = replaceChildren(current, run.id, content, options);
      if (!cleared.ok) return fromEdit(cleared, effect);
      current = cleared.part;
      continue;
    }
    // An EXISTING container is rewritten in place, kind and attributes intact. Minting a
    // typed replacement for one the read demoted would have dropped whatever demoted it
    // (a `w:val` on `w:rPr`), and a typed node may not carry that attribute at all.
    const rPr = existing
      ? ({ ...existing, children } as OoxmlNode)
      : ({
          id: nextId(),
          kind: 'runProperties',
          namespaceUri: WML_NAMESPACE_URI,
          localName: 'rPr',
          prefix: 'w',
          namespaceBindings: [],
          attributes: [],
          children,
        } as unknown as OoxmlNode);
    // `w:rPr` must lead the run's children.
    const updated = replaceChildren(current, run.id, [rPr, ...content], options);
    if (!updated.ok) return fromEdit(updated, effect);
    current = updated.part;
  }
  // Every write above replaced a `w:rPr` and kept the rest of each run by identity.
  const rebuilt = findNode(current, paragraph.id);
  if (rebuilt?.kind === 'paragraph' && rebuilt !== target) {
    const tree = current;
    carrySegmentsAcrossRunPropertyEdit(target, rebuilt, (node) => findNode(tree, node.id) === node);
    carryEmptyContentControlsAcrossRunPropertyEdit(target, rebuilt);
  }
  return ok(current, effect);
}

export { splitRunsAt };
export { paragraphTextOf } from './paragraph-model-text.ts';
