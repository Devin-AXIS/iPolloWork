import type { TreeOpReach, TreeOpTarget } from './tree-op-reach-types.ts';
export type { TreeOpReach, TreeOpTarget } from './tree-op-reach-types.ts';
import { formatContentControlDate, parseIsoDate } from './content-control-dates.ts';
export { formsProtectionCommandRefusal } from './forms-protection-command.ts';
import { withDisplayedHyphens } from '../package/hyphen-text.ts';
import {
  isInsertableText,
  LINE_BREAK_TEXT,
  propertiesHoldLineBreaks,
  textWithHyphens,
} from './tree-op-inline-elements.ts';
import {
  checkboxContent,
  checkboxStateHexes,
  isInlineControl,
  type CheckboxSymbol,
} from './content-control-checkbox.ts';
import { valueContent, withParagraphDiff } from './content-control-value-content.ts';
import { validateCommitTextFormField } from './tree-op-field-results.ts';
import { enforcesFormsProtection, sectionProtectsForms } from './forms-protection.ts';
export {
  enforcesFormsProtection,
  formsProtectionEnabled,
  sectionProtectsForms,
} from './forms-protection.ts';
import { protectedTextFormEditRefusal } from './tree-op-field-results.ts';
import { textFormFieldForEdit, textFormFieldsOf } from './text-form-fields.ts';
// Content-control writes enforce locks in the store for UI and script callers alike.
// Values retain their declared type: list items, ISO dates, or checkbox glyphs.
// Bound controls are preserved and refused; writing only their content would disagree
// with the unresolved custom XML binding when Word opens the document.

import {
  contentControlContentNodeOf,
  contentControlPropertiesContainerOf,
  contentControlPropertiesOf,
  contentControlsIn,
  lockForbidsEdit,
  lockForbidsRemoval,
  orderedContentControlProperties,
  resolveContentControlLock,
  type ContentControlKind,
  type ContentControlLock,
  type ContentControlProperties,
} from '../package/content-control-nodes.ts';
import {
  createNodeIdAllocator,
  findNode,
  parentNodeOf,
  replaceChildren,
  replaceNode,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { W14_NAMESPACE_URI, WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import { isValidXmlText } from '../package/sinks.ts';
import { holdsStoryBlock, removalEndsStoryWithTable } from '../package/ooxml-story-end-repair.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import {
  TEXT_DEPS,
  contentControlContentOf,
  fromEdit,
  parentOf,
  parseCheckboxValue,
} from './tree-op-nodes.ts';
import {
  insertionLandingNodeId,
  paragraphOffsetIndex,
  type OffsetSpan,
  type ParagraphOffsetIndex,
} from './tree-op-segments.ts';
import { scopedRevisionRoot } from './tree-op-revision-scope.ts';
import { strikesWholeControl } from './tree-op-control-strike.ts';
import { holdsRevisionContainer } from './revision-container-presence.ts';
import {
  changesOnlyLockFreeParagraphProperties,
  restoresOnlyLockFreeParagraphProperties,
} from './content-lock-paragraph-properties.ts';
import {
  isParagraphPropertyChange,
  writesOnlyParagraphProperties,
} from './bound-paragraph-properties.ts';
import { attributionTargets } from './revision-author-change.ts';
import { revisionStructuralReach, type RevisionOpAction } from './tree-op-revisions.ts';
import {
  isRevisionNode,
  revisionDecisionKeepsContent,
  revisionNodeRemovesContent,
} from './revision-content-lock.ts';
import type {
  RevisionAddress,
  TreeDocOp,
  TreeDocOpKind,
  TreeOpEffect,
  TreeOpRejection,
  TreeOpResult,
} from './tree-op-types.ts';

/** The value a control accepts, by what kind of control it is. */
export type ContentControlValueInput =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'listItem'; readonly value: string }
  | { readonly kind: 'checkbox'; readonly checked: boolean }
  /** A calendar date, `YYYY-MM-DD` or a full ISO-8601 instant. */
  | { readonly kind: 'date'; readonly iso: string };

/** The control types an insertion may author. Picture and repeating section are deferred. */
export const INSERTABLE_CONTENT_CONTROL_TYPES = [
  'richText',
  'plainText',
  'dropDownList',
  'comboBox',
  'date',
] as const satisfies readonly ContentControlKind[];

/**
 * The OOXML spellings the store writes.
 *
 * NOT the contract's `InsertableContentControlType`, which is the same set of kinds in the
 * READ vocabulary (`dropdown`) plus this lane's spelling of it (`dropDownList`). The editor
 * maps between the two; the names differ so a reader can tell which vocabulary a value is in.
 */
export type InsertableContentControlKind = (typeof INSERTABLE_CONTENT_CONTROL_TYPES)[number];

/** Longest tag/alias an op may write, so a hostile caller cannot author an unbounded attribute. */
const MAX_METADATA_LENGTH = 4_096;

/**
 * The prompt Word writes back when a control is emptied and has no glossary entry.
 *
 * The AUTHORED prompt lives in the glossary document, which this change preserves without
 * reading (`w:placeholder/w:docPart`), so a restored prompt is Word's own default for the type
 * rather than a value invented here or a prompt recovered from a part nobody loaded.
 */
const DEFAULT_PROMPTS: Readonly<Record<string, string>> = {
  date: 'Click here to enter a date.',
  dropDownList: 'Choose an item.',
  comboBox: 'Choose an item.',
  docPartList: 'Choose a building block.',
};
const DEFAULT_TEXT_PROMPT = 'Click here to enter text.';

export function promptFor(type: ContentControlKind): string {
  return DEFAULT_PROMPTS[type] ?? DEFAULT_TEXT_PROMPT;
}

// ---------------------------------------------------------------------------
// Addressing: which controls enclose a node, and what they forbid
// ---------------------------------------------------------------------------

/**
 * The controls enclosing a node, outermost first, and the node's own control when it is one.
 *
 * Resolved by walking DOWN from the part root rather than up from the node, because the tree
 * carries no parent pointers and the walk is the same bounded one every other lane uses.
 */
export function enclosingContentControls(part: OoxmlPart, nodeId: string): readonly OoxmlNode[] {
  // Climbed through the part's id→parent index rather than re-walked from the root: this
  // sits on every keystroke's validation path, and the walk it replaces visited the whole
  // document per op. Semantics are unchanged: a text-value id encloses nothing, an element
  // returns its control ancestors outermost first, and a control target always includes
  // ITSELF — including one nested or numbered past the enumeration bounds, because this
  // chain feeds lock resolution and dropping the control's own `w:lock` there would weaken
  // protection exactly for the documents an attacker shapes.
  const target = findNode(part, nodeId);
  if (!target || target.kind === 'textValue') return [];
  const ancestors: OoxmlNode[] = [];
  let parent = parentNodeOf(part, nodeId);
  while (parent) {
    if (parent.kind === 'contentControl') ancestors.push(parent);
    parent = parentNodeOf(part, parent.id);
  }
  ancestors.reverse();
  if (target.kind === 'contentControl') ancestors.push(target);
  return ancestors;
}

/** The lock in force at a node: every enclosing control's, resolved conservatively. */
export function contentControlLockAt(part: OoxmlPart, nodeId: string): ContentControlLock {
  return resolveContentControlLock(
    enclosingContentControls(part, nodeId).map(
      (control) => contentControlPropertiesOf(control).lock
    )
  );
}

// ---------------------------------------------------------------------------
// Reach: what an op would change, classified once for every policy that refuses
// ---------------------------------------------------------------------------

/** A point at which content is written: the leading edge of a control belongs to the control. */
const writingAt = (nodeId: string, offset: number, bias?: 'left' | 'right'): TreeOpReach => ({
  kind: 'nodes',
  targets: [
    { nodeId, range: { start: offset, end: offset }, writes: true, point: 'run-content', bias },
  ],
});

/** A structural inline sibling that the applier always places directly in the paragraph. */
const siblingAt = (nodeId: string, offset: number): TreeOpReach => ({
  kind: 'nodes',
  targets: [
    { nodeId, range: { start: offset, end: offset }, writes: true, point: 'paragraph-sibling' },
  ],
});

/** A new inline control splits each existing inline control that strictly contains the caret. */
const splittingControlAt = (nodeId: string, offset: number): TreeOpReach => ({
  kind: 'nodes',
  targets: [{ nodeId, range: { start: offset, end: offset }, point: 'inline-control-split' }],
});

/** A point that writes nothing into the run it names — a marker, or a split. */
const beside = (nodeId: string, offset: number): TreeOpReach => ({
  kind: 'nodes',
  targets: [{ nodeId, range: { start: offset, end: offset }, point: 'container-marker' }],
});
const over = (nodeId: string, start: number, end: number): TreeOpReach => ({
  kind: 'nodes',
  targets: [{ nodeId, range: { start, end } }],
});
const whole = (nodeId: string): TreeOpReach => ({ kind: 'nodes', targets: [{ nodeId }] });
/** The node's children are rearranged, so everything it holds is affected. */
const restructuring = (nodeId: string): TreeOpReach => ({
  kind: 'nodes',
  targets: [{ nodeId, structural: true }],
});
/** Each named node on its own, for an op addressed at a set of cells. */
const each = (nodeIds: readonly string[]): TreeOpReach => ({
  kind: 'nodes',
  targets: asArray(nodeIds).map((nodeId) => ({ nodeId })),
});

/**
 * Reach is resolved BEFORE validation, so a list on an op is still whatever the caller sent.
 *
 * The list-shaped ops check `Array.isArray` in their own validators for exactly this reason; a
 * classification that walked the value first would turn a malformed op into a thrown exception
 * instead of the refusal the caller is owed.
 */
function asArray<T>(value: readonly T[]): readonly T[] {
  return Array.isArray(value) ? value : [];
}

/** Paragraphs an op names in a list, each having its runs rewritten. */
const inParagraphs = (
  entries: readonly { readonly paragraphId: string }[]
): readonly TreeOpTarget[] =>
  asArray(entries).map((entry) => ({ nodeId: entry.paragraphId, structural: true }));

/**
 * How each op reaches, one entry per op kind.
 *
 * A mapped type over `TreeDocOpKind`, so a new op that nobody classifies does not compile. The
 * runtime lookup then fails closed as well, for an op name that reached here from JavaScript.
 */
const TREE_OP_REACH: {
  readonly [K in TreeDocOpKind]: (op: Extract<TreeDocOp, { readonly op: K }>) => TreeOpReach;
} = {
  // A caller that NAMES the control it is writing into has said where the text goes, so that is
  // the control the refusals are resolved against — the offset no longer decides.
  insertText: (op) =>
    op.inside === undefined
      ? writingAt(op.paragraphId, op.offset, op.bias)
      : {
          kind: 'control',
          controlId: op.inside,
          intent: 'value',
          at: { paragraphId: op.paragraphId, offset: op.offset },
        },
  deleteText: (op) =>
    op.revision === undefined
      ? over(op.paragraphId, op.start, op.end)
      : {
          kind: 'nodes',
          targets: [
            {
              nodeId: op.paragraphId,
              range: { start: op.start, end: op.end },
              strikesCovered: true,
            },
          ],
        },
  insertTab: (op) => writingAt(op.paragraphId, op.offset, op.bias),
  insertHardBreak: (op) => writingAt(op.paragraphId, op.offset, op.bias),
  insertPageBreak: (op) => writingAt(op.paragraphId, op.offset, op.bias),
  insertPageField: (op) => writingAt(op.paragraphId, op.offset),
  insertComplexField: (op) => writingAt(op.paragraphId, op.offset),
  insertEquation: (op) => writingAt(op.paragraphId, op.offset),
  // Plain anchors sit beside text. A tracked note uses the tracked run-content applier.
  insertCommentMarker: (op) => beside(op.paragraphId, op.offset),
  insertNote: (op) =>
    op.revision === undefined
      ? beside(op.paragraphId, op.offset)
      : writingAt(op.paragraphId, op.offset),
  setRunProperties: (op) => over(op.paragraphId, op.start, op.end),
  insertHyperlink: (op) => over(op.paragraphId, op.start, op.end),
  // An insertion AUTHORS a control beside the runs, and never writes into one. `writes` is
  // what marks an edit as "filling in a field", which is the one thing forms protection lets
  // through — and this is the opposite of filling: under `w:edit="forms"` a new control in the
  // body must be refused however unlocked the field beside it is. So the caret shape reaches
  // like the range shape, and a caret at a control's EDGE lands outside that control, which is
  // exactly where the applier puts it.
  insertContentControl: (op) => over(op.paragraphId, op.start, op.end),
  insertInlineContentControl: (op) => splittingControlAt(op.paragraphId, op.offset),
  insertFragment: (op) => siblingAt(op.paragraphId, op.offset),
  // A split at a control's edge moves the whole control to one side of the break and changes
  // nothing it holds, so neither edge is inside. A split WITHIN it is, and the range says so.
  splitParagraph: (op) => beside(op.paragraphId, op.offset),
  splitParagraphMany: (op) => ({
    kind: 'nodes',
    targets: op.offsets.map((offset) => ({
      nodeId: op.paragraphId,
      range: { start: offset, end: offset },
    })),
  }),
  // A join moves the second paragraph's content into the first. A control inside either one
  // moves whole and keeps what it holds, so only the controls ENCLOSING the paragraphs are
  // edited; naming the paragraphs without a range asks exactly those.
  joinParagraphs: (op) => ({
    kind: 'nodes',
    targets: [{ nodeId: op.firstId }, { nodeId: op.secondId }],
  }),
  setParagraphProperties: (op) => whole(op.paragraphId),
  setParagraphMarkProperties: (op) => whole(op.paragraphId),
  setParagraphMarkRevision: (op) => whole(op.paragraphId),
  proposeParagraphMerge: (op) => whole(op.paragraphId),
  setListLevel: (op) => whole(op.paragraphId),
  setListNumbering: (op) => whole(op.paragraphId),
  setParagraphTabStops: (op) => whole(op.paragraphId),
  setParagraphBorders: (op) => whole(op.paragraphId),
  setSectionMark: (op) => whole(op.paragraphId),
  deleteBlock: (op) => ({ kind: 'nodes', targets: [{ nodeId: op.blockId, removes: true }] }),
  // A link is a node in a paragraph, so its OWNER is resolved the same way any node's is: the
  // controls the walk passes through on its way down to the link.
  setHyperlinkTarget: (op) => whole(op.linkId),
  removeHyperlink: (op) => ({ kind: 'nodes', targets: [{ nodeId: op.linkId, structural: true }] }),
  setMathEquation: (op) => whole(op.equationId),
  removeMathEquation: (op) => ({
    kind: 'nodes',
    targets: [{ nodeId: op.equationId, structural: true }],
  }),
  acceptRevision: (op) => ({
    kind: 'revisions',
    action: 'accept',
    revision: op.revision,
    ...(op.localName === undefined ? {} : { localName: op.localName }),
    ...(op.siteNodeIds === undefined ? {} : { siteNodeIds: op.siteNodeIds }),
  }),
  rejectRevision: (op) => ({
    kind: 'revisions',
    action: 'reject',
    revision: op.revision,
    ...(op.localName === undefined ? {} : { localName: op.localName }),
    ...(op.siteNodeIds === undefined ? {} : { siteNodeIds: op.siteNodeIds }),
  }),
  acceptAllRevisions: (op) => ({
    kind: 'revisions',
    action: 'accept',
    ...(op.siteNodeIds === undefined ? {} : { siteNodeIds: op.siteNodeIds }),
    ...(op.scopeRootId === undefined ? {} : { scopeRootId: op.scopeRootId }),
  }),
  rejectAllRevisions: (op) => ({
    kind: 'revisions',
    action: 'reject',
    ...(op.siteNodeIds === undefined ? {} : { siteNodeIds: op.siteNodeIds }),
    ...(op.scopeRootId === undefined ? {} : { scopeRootId: op.scopeRootId }),
  }),
  setRevisionAttribution: (op) => ({ kind: 'nodes', targets: attributionTargets(op) }),
  // The value path rebuilds `w:sdtContent`; a tag or an alias leaves every child where it was.
  setContentControlValue: (op) => ({
    kind: 'control',
    controlId: op.controlId,
    intent: 'value',
    replacesContent: true,
  }),
  setContentControlProperties: (op) => ({
    kind: 'control',
    controlId: op.controlId,
    intent: 'metadata',
  }),
  // Keeping the content splices it into the parent, so everything nested survives and nothing
  // nested has a say. Taking the content is the same destruction a value write performs.
  removeContentControl: (op) => ({
    kind: 'control',
    controlId: op.controlId,
    intent: 'removal',
    replacesContent: op.keepContent !== true,
  }),
  // An item is what a repeating section exists to hold, so adding one is addressed AT the
  // control the same way a value write is — and it is the gesture forms protection allows.
  // Removing one destroys whatever that item held, including controls the caller never named,
  // and the item's own id is not in the op: `replacesContent` asks all of them.
  addRepeatingSectionItem: (op) => ({
    kind: 'control',
    controlId: op.controlId,
    intent: 'value',
  }),
  removeRepeatingSectionItem: (op) => ({
    kind: 'control',
    controlId: op.controlId,
    intent: 'value',
    replacesContent: true,
  }),
  // TABLE TOPOLOGY restructures the table itself: a row or a column arrives or leaves and every
  // cell after it shifts. The TABLE is therefore the node they rearrange — naming only the row
  // or the grid column would ask permission of one cell while rewriting the rest around it.
  // These write BESIDE their anchor, never into it: the controls enclosing it answer them.
  insertTable: (op) => ({ kind: 'nodes', targets: [{ nodeId: op.beforeParagraphId }] }),
  insertParagraphBesideTable: (op) => ({ kind: 'nodes', targets: [{ nodeId: op.tableId }] }),
  // A move leaves one place and writes beside the anchor, so it is asked of both.
  moveTable: (op) => ({
    kind: 'nodes',
    targets: [{ nodeId: op.tableId, removes: true }, { nodeId: op.beforeBlockId }],
  }),
  insertTableRow: (op) => restructuring(op.tableId),
  deleteTableRow: (op) => ({
    kind: 'nodes',
    targets: [
      { nodeId: op.tableId, structural: true },
      // The row goes and takes its cells' controls with it, so removal locks apply to them.
      // A tracked deletion retains the row, but the reach is the same question either way.
      { nodeId: op.rowId, removes: true },
    ],
  }),
  insertTableColumn: (op) => restructuring(op.tableId),
  // A column delete removes one cell FROM EVERY ROW, and which cells those are is a topology
  // question resolved in the applier, not re-derived here. Both targets name the whole table
  // on purpose: the first says its content is rearranged, which is what a `w:dataBinding`
  // answers, and the second says content is destroyed, which is what a removal lock answers.
  // Collapsing them into one target answered whichever question that target's flags reached
  // and left the other side of the table's protection unasked.
  deleteTableColumn: (op) => ({
    kind: 'nodes',
    targets: [
      { nodeId: op.tableId, structural: true },
      { nodeId: op.tableId, removes: true },
    ],
  }),
  // A merge removes cells and moves their content, so it asks both questions a column delete
  // asks. A split only rearranges.
  mergeTableCells: (op) => ({
    kind: 'nodes',
    targets: [
      { nodeId: op.tableId, structural: true },
      { nodeId: op.tableId, removes: true },
    ],
  }),
  splitTableCell: (op) => restructuring(op.tableId),
  // Geometry and cell decoration change PROPERTIES. Every control inside keeps every character
  // it held, so only the controls ENCLOSING the addressed node are asked — the same answer
  // `setParagraphProperties` gives for a paragraph.
  setTableColumnWidths: (op) => whole(op.tableId),
  setTableRightEdgeWidth: (op) => whole(op.tableId),
  setTableRowHeight: (op) => whole(op.rowId),
  setTableCellBorders: (op) => each(op.cellIds),
  authorTable: (op) =>
    op.action.kind === 'insert' ? each([op.action.paragraphId]) : each([op.action.tableId]),
  setTableProperties: (op) => each([op.tableId]),
  setTableCellFill: (op) => each(op.cellIds),
  setTableCellVerticalAlignment: (op) => each(op.cellIds),
  insertDrawing: (op) => writingAt(op.paragraphId, op.offset, op.bias),
  moveInlineDrawing: (op) => ({
    kind: 'nodes',
    targets: [
      { nodeId: op.drawingNodeId, removes: true },
      {
        nodeId: op.paragraphId,
        range: { start: op.offset, end: op.offset },
        writes: true,
        point: 'run-content',
      },
    ],
  }),
  replaceDrawingResource: (op) => whole(op.drawingNodeId),
  deleteDrawing: (op) => ({
    kind: 'nodes',
    targets: [{ nodeId: op.drawingNodeId, removes: true }],
  }),
  resizeDrawing: (op) => whole(op.drawingNodeId),
  cropDrawing: (op) => whole(op.drawingNodeId),
  positionDrawing: (op) => whole(op.drawingNodeId),
  setDrawingWrap: (op) => whole(op.drawingNodeId),
  setDrawingMetadata: (op) => whole(op.drawingNodeId),
  setDrawingLocks: (op) => whole(op.drawingNodeId),
  transformDrawing: (op) => whole(op.drawingNodeId),
  setShapeFormat: (op) => whole(op.drawingNodeId),
  // A TOC is inserted BESIDE the named paragraph, in the body: the controls that matter are the
  // ones enclosing that paragraph, plus the headings the op writes bookmarks into.
  insertToc: (op) => ({
    kind: 'nodes',
    targets: [{ nodeId: op.beforeParagraphId }, ...inParagraphs(op.bookmarksToCreate)],
  }),
  // A refresh REBUILDS the cached result and a removal takes it out; both reach all of `tocId`
  // (the control, else the field's begin node). Page numbers reach only the named paragraphs.
  replaceTocResult: (op) => ({
    kind: 'nodes',
    targets: [{ nodeId: op.tocId, structural: true }, ...inParagraphs(op.bookmarksToCreate)],
  }),
  removeToc: (op) => restructuring(op.tocId),
  rewriteTocPageNumbers: (op) => ({ kind: 'nodes', targets: inParagraphs(op.updates) }),
  // A field-result refresh rewrites result runs in the paragraphs the op names, nothing else.
  setFieldCode: (op) => whole(op.fieldNodeId),
  setFieldResult: (op) => whole(op.fieldNodeId),
  setTextFormFieldDefault: (op) => whole(op.fieldNodeId),
  commitTextFormField: (op) => whole(op.fieldNodeId),
  setLegacyCheckbox: (op) => whole(op.fieldNodeId),
  setLegacyDropdown: (op) => whole(op.fieldNodeId),
  insertBookmark: (op) => beside(op.start.paragraphId, op.start.offset),
  deleteBookmark: () => ({ kind: 'none' }),
  // A building block pick rebuilds `w:sdtContent`, exactly as a value write does.
  insertBuildingBlock: (op) => ({
    kind: 'control',
    controlId: op.controlId,
    intent: 'value',
    replacesContent: true,
  }),
  refreshFieldResults: (op) => ({ kind: 'nodes', targets: inParagraphs(op.updates) }),
  replaceStoryBlocks: (op) => ({
    kind: 'nodes',
    targets: [{ nodeId: op.storyRootId, structural: true }],
  }),
  // Document properties: page, furniture, watermark and notes. No control lock; forms still lock.
  setSectionProperties: () => ({ kind: 'documentProperties' }),
  setSectionFurnitureOptions: () => ({ kind: 'documentProperties' }),
  setDocumentProtection: () => ({ kind: 'documentProperties' }),
  setWatermark: () => ({ kind: 'documentProperties' }),
  setNoteProperties: () => ({ kind: 'documentProperties' }),
  // A note's own id is not a body address, and removing or converting one rewrites the run that
  // referenced it — wherever that run happens to be.
  deleteNote: () => ({ kind: 'part' }),
  convertNote: () => ({ kind: 'part' }),
  convertAllNotes: () => ({ kind: 'part' }),
  // Furniture LIFECYCLE creates, deletes and rewires header/footer parts. It changes no body
  // content, and classifying it as a write would refuse a header in any document that happens to
  // hold a locked field. Edits to a header's own text are ordinary story ops in that part, and
  // meet these refusals there.
  createHeaderFooter: () => ({ kind: 'none' }),
  deleteHeaderFooter: () => ({ kind: 'none' }),
  linkToPrevious: () => ({ kind: 'none' }),
  unlinkFromPrevious: () => ({ kind: 'none' }),
};

/** The op kinds the classification declares, for the test that proves it covers the vocabulary. */
export const TREE_OP_REACH_CLASSIFIED: ReadonlySet<string> = new Set(Object.keys(TREE_OP_REACH));

/** What an op would change. An op name nothing declares reaches the whole part. */
export function treeOpReach(op: TreeDocOp): TreeOpReach {
  const classify = TREE_OP_REACH[op.op] as ((one: TreeDocOp) => TreeOpReach) | undefined;
  if (!classify) return { kind: 'part' };
  return classify(op);
}

/** One control an op would affect, and how. */
interface ControlTouch {
  readonly control: OoxmlNode;
  /** Every lock in force on it: its own and each of its ancestors'. */
  readonly locks: readonly ContentControlLock[];
  /** The control itself would be removed, not merely edited — and the caller ASKED for that. */
  readonly removed: boolean;
  /**
   * The control would be destroyed by an op addressed at something else.
   *
   * The difference from {@link removed} is consent, and only `w:dataBinding` cares. Deleting a
   * bound control the caller NAMED is allowed, because it takes the claim to mirror a custom XML
   * part away with it. Deleting one the caller never mentioned, as the collateral of setting some
   * enclosing control's value, is not that decision being made — it is the projection being
   * thrown away by an op that was about something else.
   */
  readonly discarded: boolean;
  /**
   * For a {@link removed} control: the locks of the controls that SURVIVE around it.
   *
   * Removing a control edits the content of whatever encloses it, never its own: its own
   * `contentLocked` protects what it holds and lets the control go, and the controls nested in
   * it go with it. So the edit half of the lock is asked of the survivors only, and the removal
   * half of the whole chain.
   */
  readonly survivingLocks?: readonly ContentControlLock[];
  /** A revision decision that keeps the content as it reads: no content lock refuses it. */
  readonly keepsContent?: boolean;
  /** A decision on a paragraph property change: it leaves a bound control's text alone. */
  readonly paragraphPropertiesOnly?: boolean;
  /** A removed control locked only against removal stays as an empty shell. */
  readonly shellKept?: boolean;
}

/** What an op reaches, resolved against the part: the controls, and the nodes it named. */
interface ResolvedReach {
  readonly touches: readonly ControlTouch[];
  /** The nodes the op named that sit inside NO control — what forms protection asks about. */
  readonly unprotected: readonly string[];
}

const NOTHING: ResolvedReach = { touches: [], unprotected: [] };

function locksOf(chain: readonly OoxmlNode[]): readonly ContentControlLock[] {
  return chain.map((control) => contentControlPropertiesOf(control).lock);
}

/**
 * Every control an op would affect, and every node it named that no control protects.
 *
 * ONE resolution, three policies. A lock asks whether any touched control forbids the change, a
 * `w:dataBinding` asks whether any touched control mirrors a part this engine does not evaluate,
 * and forms protection asks the inverse question about the nodes outside every control. They used
 * to answer from three different walks over three different op allowlists, which is how an inline
 * control ended up unprotected in all three.
 */
export function resolveReach(part: OoxmlPart, reach: TreeOpReach): ResolvedReach {
  if (reach.kind === 'none') return NOTHING;
  // No control is touched — no lock, no binding — and nothing here is inside a control, so a
  // protected document refuses it.
  if (reach.kind === 'documentProperties') return { touches: [], unprotected: [part.root.id] };
  if (reach.kind === 'part') {
    // Everything: each control, with its own chain, edited but not removed.
    const touches = contentControlsIn(part.root).map((entry) => ({
      control: entry.node,
      locks: locksOf([...entry.ancestors, entry.node]),
      removed: false,
      discarded: false,
    }));
    return { touches, unprotected: [part.root.id] };
  }
  if (reach.kind === 'control') {
    const chain = enclosingContentControls(part, reach.controlId);
    const own = chain[chain.length - 1];
    // A NAME THAT IS NOT A CONTROL BUYS NOTHING. Being addressed at a control is what forms
    // protection exempts, so a reach that says so and cannot produce the control is the shape a
    // forged one has — resolving it to "nothing touched, nothing unprotected" would let any node
    // in a protected document be written to by claiming to be a field. Validation refuses these
    // too; this is the half that runs before it, at the package gate.
    if (!own || own.id !== reach.controlId || own.kind !== 'contentControl') {
      return { touches: [], unprotected: [part.root.id] };
    }
    // EVERY CONTROL BETWEEN THE PART ROOT AND WHERE THE WRITE LANDS. For a positioned value
    // write that is the named control's ancestors, the control itself, AND any control nested
    // inside it that the content would go into. The ancestors matter for the same reason: a
    // binding on an enclosing control is desynced by a write to what it encloses.
    const line =
      reach.intent === 'value' && reach.at !== undefined
        ? mergedLine(chain, landingControls(part, reach.at, own))
        : chain;
    return {
      touches: [
        ...line.map((control, index) => ({
          control,
          locks: locksOf(line.slice(0, index + 1)),
          // Only the NAMED control goes away; the ones enclosing it and the ones it encloses are
          // edited, not removed.
          removed: reach.intent === 'removal' && control.id === own.id,
          discarded: false,
        })),
        ...discardedContentControls(own, reach.replacesContent === true),
      ],
      // A write ADDRESSED to a control is what forms protection exists to allow; changing or
      // removing the control ITSELF is not, unless the control is inside another one.
      unprotected: reach.intent === 'value' || chain.length > 1 ? [] : [reach.controlId],
    };
  }
  if (reach.kind === 'revisions') {
    return resolveRevisionReach(
      part,
      reach.action,
      reach.revision,
      reach.localName,
      reach.siteNodeIds,
      reach.scopeRootId
    );
  }
  const touches: ControlTouch[] = [];
  const unprotected: string[] = [];
  for (const target of reach.targets) {
    const targetNode = findNode(part, target.nodeId);
    if (
      targetNode?.kind === 'paragraph' &&
      target.point === 'inline-control-split' &&
      target.range !== undefined
    ) {
      const enclosing = enclosingContentControls(part, targetNode.id);
      for (let index = 0; index < enclosing.length; index += 1) {
        touches.push({
          control: enclosing[index]!,
          locks: locksOf(enclosing.slice(0, index + 1)),
          removed: false,
          discarded: false,
        });
      }
      const inherited = locksOf(enclosing);
      const offsets = paragraphOffsetIndex(targetNode);
      for (const entry of contentControlsIn(targetNode)) {
        const span = offsets.spanOf(entry.node);
        if (!span || target.range.start <= span.start || target.range.start >= span.end) continue;
        touches.push({
          control: entry.node,
          locks: inherited.concat(locksOf(entry.ancestors.concat(entry.node))),
          removed: false,
          discarded: false,
        });
      }
      // Adding a control is document structure, not a permitted form-field value edit.
      unprotected.push(targetNode.id);
      continue;
    }
    if (
      targetNode?.kind === 'paragraph' &&
      (target.point === 'run-content' || target.point === 'paragraph-sibling') &&
      target.range !== undefined &&
      target.range.start === target.range.end
    ) {
      const landing =
        target.point === 'run-content'
          ? insertionLandingNodeId(targetNode, target.range.start, null, target.bias)
          : targetNode.id;
      const controls = enclosingContentControls(part, landing);
      for (let index = 0; index < controls.length; index += 1) {
        touches.push({
          control: controls[index]!,
          locks: locksOf(controls.slice(0, index + 1)),
          removed: false,
          discarded: false,
        });
      }
      if (controls.length === 0) unprotected.push(target.nodeId);
      continue;
    }
    const chain = enclosingContentControls(part, target.nodeId);
    const enclosing = chain.filter((node) => node.id !== target.nodeId);
    for (let index = 0; index < enclosing.length; index += 1) {
      touches.push({
        control: enclosing[index]!,
        locks: locksOf(enclosing.slice(0, index + 1)),
        removed: false,
        discarded: false,
      });
    }
    const node = targetNode;
    if (!node || node.kind === 'textValue') {
      if (enclosing.length === 0) unprotected.push(target.nodeId);
      continue;
    }
    const inherited = locksOf(enclosing);

    // Controls INSIDE the named node. A removal takes them with it; a restructuring moves them;
    // and a range addresses the ones whose own characters it overlaps.
    const inside = contentControlsIn(node);
    // Built only for a paragraph that actually holds a control, because this runs on the path a
    // keystroke takes and nearly every paragraph holds none.
    let offsets: ParagraphOffsetIndex | null = null;
    const spanOf = (control: OoxmlNode): OffsetSpan | null => {
      if (node.kind !== 'paragraph') return null;
      offsets ??= paragraphOffsetIndex(node);
      return offsets.spanOf(control);
    };
    let filling = false;
    for (const entry of inside) {
      const span = spanOf(entry.node);
      const locks = [...inherited, ...locksOf([...entry.ancestors, entry.node])];
      // A tracked deletion that strikes the control WHOLE proposes removing the field, which is
      // not filling it in, so forms protection must not let it through as an edit inside one.
      const struckWhole =
        target.strikesCovered === true &&
        target.range !== undefined &&
        strikesWholeControl(span, target.range, resolveContentControlLock(locks), entry.node);
      // WHAT FORMS PROTECTION LETS THROUGH is an edit that stays within one field. Asking whether
      // the NAMED NODE is inside a control answers "no" for every inline field — the paragraph
      // around it is not the field — so it is asked of the addressed range instead.
      if (
        !struckWhole &&
        target.range !== undefined &&
        encloses(span, target.range, target.writes === true)
      ) {
        filling = true;
      }
      const affected =
        target.removes === true ||
        target.structural === true ||
        (target.range !== undefined && intersects(span, target.range, target.writes === true));
      if (!affected) continue;
      const removed = target.removes === true || struckWhole;
      touches.push({
        control: entry.node,
        locks,
        removed,
        discarded: false,
        ...(removed ? { survivingLocks: inherited } : {}),
      });
    }
    if (enclosing.length === 0 && !filling) unprotected.push(target.nodeId);
  }
  return { touches, unprotected };
}

/**
 * The controls a whole-content write would destroy: everything nested inside the named one.
 *
 * ONLY THEIR OWN LINE IS ASKED, not the named control's. Whether the named control permits this
 * operation at all is a question its own lock already answered — for a value write in the touches
 * above, for a removal in `applyRemoveContentControl`. Folding that answer in a second time would
 * make an enclosing `sdtLocked`, which forbids deleting the ENCLOSING control and expressly allows
 * editing its content, refuse a value write merely because something unlocked was nested in it.
 *
 * The walk is `contentControlsIn`, so it carries the same nesting and element bounds as every
 * other file-driven descent in this module.
 */
function discardedContentControls(own: OoxmlNode, replacesContent: boolean): ControlTouch[] {
  if (!replacesContent) return [];
  return contentControlsIn(own).map((entry) => ({
    control: entry.node,
    locks: locksOf([...entry.ancestors, entry.node]),
    removed: false,
    discarded: true,
  }));
}

/**
 * The controls enclosing where a NAMED insertion would actually go, outermost first.
 *
 * Resolved through {@link insertionLandingNodeId}, the same rule the applier writes by, so
 * validation and application are asking about one place. That includes the case where no run
 * exists to join: the run is minted into a NODE — the addressed paragraph, or a named inline
 * control's own content — and every control holding that node receives it.
 */
function landingControls(
  part: OoxmlPart,
  at: { readonly paragraphId: string; readonly offset: number },
  own: OoxmlNode
): readonly OoxmlNode[] {
  const paragraph = findNode(part, at.paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  return enclosingContentControls(part, insertionLandingNodeId(paragraph, at.offset, own));
}

/** Both chains, outermost first, each control once. Fails wide when the two disagree. */
function mergedLine(
  chain: readonly OoxmlNode[],
  landing: readonly OoxmlNode[]
): readonly OoxmlNode[] {
  if (landing.length === 0) return chain;
  const merged: OoxmlNode[] = [...landing];
  const seen = new Set(landing.map((control) => control.id));
  for (const control of chain) {
    if (seen.has(control.id)) continue;
    seen.add(control.id);
    merged.push(control);
  }
  return merged;
}

/**
 * Whether a control's own characters overlap the offsets an op addresses.
 *
 * THE TWO EDGES ARE DIFFERENT PLACES. The applier gives a boundary offset to the run that starts
 * there, so a point op that writes content at a control's leading edge lands in the control's
 * first run, and the same op at its trailing edge lands in whatever follows. A point that writes
 * nothing — a comment marker, a paragraph split — is beside the control at either edge.
 *
 * A non-empty range that so much as touches the inside is refused WHOLE: a partial edit that
 * clipped itself to the unlocked side would silently do something other than what was asked.
 */
function intersects(span: OffsetSpan | null, range: OffsetSpan, writes: boolean): boolean {
  if (span === null) return false;
  if (range.end <= range.start) {
    return writes
      ? range.start >= span.start && range.start < span.end
      : range.start > span.start && range.start < span.end;
  }
  return range.start < span.end && range.end > span.start;
}

/** Whether an op addresses only characters this control holds — the "filling in a field" case. */
function encloses(span: OffsetSpan | null, range: OffsetSpan, writes: boolean): boolean {
  if (span === null) return false;
  if (range.end <= range.start) return intersects(span, range, writes);
  return range.start >= span.start && range.end <= span.end;
}

/** The nodes a revision decision would rewrite, and the controls holding them. */
function resolveRevisionReach(
  part: OoxmlPart,
  action: RevisionOpAction,
  revision: RevisionAddress | undefined,
  localName: string | undefined,
  siteNodeIds: readonly string[] | undefined,
  scopeRootId?: string
): ResolvedReach {
  const touches: ControlTouch[] = [];
  const unprotected: string[] = [];
  const siteNodeIdSet = siteNodeIds === undefined ? undefined : new Set(siteNodeIds);
  const root = scopeRootId === undefined ? part.root : scopedRevisionRoot(part, scopeRootId);
  // Reach runs before validation. An invalid scoped root must fail closed here; validation then
  // reports the malformed canonical address without granting it a narrower protection reach.
  if (root === null) {
    return { touches, unprotected: [part.root.id] };
  }
  let seen = 0;
  const walk = (node: OoxmlNode, controls: readonly OoxmlNode[]): void => {
    if (node.kind === 'textValue' || seen > MAX_REVISION_NODES) return;
    if (!holdsRevisionContainer(node)) return;
    if (isRevisionNode(node, revision, localName, siteNodeIdSet)) {
      seen += 1;
      if (controls.length === 0) unprotected.push(node.id);
      const keepsContent =
        revisionDecisionKeepsContent(node, action) ||
        (action === 'reject' && restoresOnlyLockFreeParagraphProperties(part, node));
      for (let index = 0; index < controls.length; index += 1) {
        touches.push({
          control: controls[index]!,
          locks: locksOf(controls.slice(0, index + 1)),
          removed: false,
          discarded: false,
          keepsContent,
          paragraphPropertiesOnly: isParagraphPropertyChange(node),
        });
      }
      // Only the direction that removes a revision wrapper's content removes nested controls.
      // The keep direction still reaches the marker and its enclosing controls above.
      if (revisionNodeRemovesContent(node, action)) {
        // An insertion or deletion keeps a control locked only against removal as an empty
        // shell. A move takes the control whole.
        const shellKept = node.localName === 'ins' || node.localName === 'del';
        for (const entry of contentControlsIn(node)) {
          touches.push({
            control: entry.node,
            locks: [...locksOf(controls), ...locksOf([...entry.ancestors, entry.node])],
            removed: true,
            discarded: false,
            survivingLocks: locksOf(controls),
            shellKept,
          });
        }
        // Nothing below a discarded wrapper survives this decision. Its controls were marked as
        // removed above, so descending would only duplicate touches.
        return;
      }
      // Keeping/restoring this wrapper means unwrapping it into the parent. Nested revisions still
      // take their own decision during accept-all/reject-all, with the same enclosing controls.
      // For a directly addressed operation `isRevisionNode` continues to enforce the address and
      // optional localName, so an unrelated nested wrapper remains untouched.
    }
    for (const child of node.children) {
      walk(child, child.kind === 'contentControl' ? [...controls, child] : controls);
    }
  };
  walk(root, []);
  // Markers can sit outside the cells and controls whose content or geometry they change.
  const structural = revisionStructuralReach(part, action, revision, {
    ...(localName === undefined ? {} : { localName }),
    ...(siteNodeIds === undefined ? {} : { siteNodeIds }),
    ...(scopeRootId === undefined ? {} : { scopeRootId }),
  });
  const walkStructural = (node: OoxmlNode, controls: readonly OoxmlNode[]): void => {
    if (node.kind === 'textValue' || structural.size === 0) return;
    const removed = structural.get(node.id);
    if (removed !== undefined) {
      for (let index = 0; index < controls.length; index += 1) {
        touches.push({
          control: controls[index]!,
          locks: locksOf(controls.slice(0, index + 1)),
          removed: false,
          discarded: false,
        });
      }
      for (const entry of contentControlsIn(node)) {
        touches.push({
          control: entry.node,
          locks: [...locksOf(controls), ...locksOf([...entry.ancestors, entry.node])],
          removed,
          discarded: false,
          ...(removed ? { survivingLocks: locksOf(controls) } : {}),
        });
      }
      if (removed) return;
    }
    for (const child of node.children)
      walkStructural(child, child.kind === 'contentControl' ? [...controls, child] : controls);
  };
  walkStructural(root, []);
  return { touches, unprotected };
}

/** Bounds the revision scan the way every other file-driven walk in this module is bounded. */
const MAX_REVISION_NODES = 50_000;

/**
 * Whether a lock refuses an op, checked before any tree work.
 *
 * Resolved from the op's REACH rather than from a list of op names: a template that locks a field
 * means the field, and a caller who could still restyle it, renumber it, accept a tracked change
 * inside it or retarget the link it holds has not been stopped by anything.
 */
export function contentControlLockRefusal(part: OoxmlPart, op: TreeDocOp): TreeOpRejection | null {
  // Alignment, indents, and spacing place the paragraph around the locked text; binding and
  // forms checks still run.
  if (changesOnlyLockFreeParagraphProperties(part, op)) return null;
  const reach = treeOpReach(op);
  // Changing a control's METADATA and REMOVING it are refused by different halves of `ST_Lock`
  // than an edit is — `contentLocked` protects the contents and lets the control go, `sdtLocked`
  // the reverse — and each is resolved in the applier that already holds the control. A write
  // addressed at a control's VALUE is an ordinary content edit and is resolved here, because the
  // caller might have reached it through `insertText` naming the control it writes into.
  //
  // What NO applier resolves either way is a control the op was not addressed at and would
  // destroy anyway, so those are asked here whatever the intent was.
  const namedControlAnswersForItself = reach.kind === 'control' && reach.intent !== 'value';
  // A control nested in one being removed goes with it, so only its removal half is asked.
  const removingNamedControl = reach.kind === 'control' && reach.intent === 'removal';
  for (const touch of resolveReach(part, reach).touches) {
    if ((namedControlAnswersForItself && !touch.discarded) || touch.keepsContent) continue;
    const resolved = resolveContentControlLock(touch.locks);
    if (touch.discarded && removingNamedControl) {
      if (lockForbidsRemoval(resolved)) return 'locked';
      continue;
    }
    const edited = touch.survivingLocks
      ? resolveContentControlLock(touch.survivingLocks)
      : resolved;
    if (lockForbidsEdit(edited)) return 'locked';
    const shell = touch.shellKept && !lockForbidsEdit(resolved);
    if ((touch.removed || touch.discarded) && lockForbidsRemoval(resolved) && !shell)
      return 'locked';
  }
  return null;
}

/**
 * Whether `w:dataBinding` refuses an op.
 *
 * A bound control's content MIRRORS a node in a custom XML part. This engine preserves the
 * binding without evaluating it, so it cannot keep the two sides in step: the only honest answer
 * to a write is to refuse it and leave both sides as the file wrote them. `setContentControlValue`
 * always answered this way; ordinary typing, formatting and deleting did not, which meant the
 * value could be changed through the path a keystroke takes while the part still held the old one.
 *
 * Removing the control the caller NAMED is not refused. The desync this prevents is content
 * changing while something still claims to mirror a part; removing that control removes the claim,
 * and refusing it instead would make a bound control indelible in an editor where Word deletes it.
 *
 * A bound control the caller did NOT name is a different question, and it is refused. Setting an
 * enclosing control's value rebuilds that content from nothing, so the binding, its `w:xpath` and
 * the projection the file wrote all disappear — not as the decision the caller made, but as the
 * collateral of one about something else. A script that means to drop a bound field can still name
 * it and delete it.
 */
export function contentControlBindingRefusal(
  part: OoxmlPart,
  op: TreeDocOp
): TreeOpRejection | null {
  const reach = treeOpReach(op);
  // Metadata and removal do not touch the NAMED control's bound value. A VALUE write does, and is
  // refused here rather than left to an applier: `setContentControlValue` has one that answers
  // this, but an insertion that merely NAMES the control it writes into reaches the same content
  // through the ordinary text path, where no applier was looking. Either way, a bound control
  // discarded along with the content is answered below whatever the intent was.
  const namedControlAnswersForItself = reach.kind === 'control' && reach.intent !== 'value';
  // A document-scoped op does not write the bound value either: page setup and note settings
  // cannot desync a custom XML part, and refusing them would make a bound field freeze the
  // document's own layout.
  if (reach.kind === 'part' || reach.kind === 'documentProperties') return null;
  // The binding mirrors text, so paragraph properties stay free (`bound-paragraph-properties.ts`).
  if (writesOnlyParagraphProperties(op)) return null;
  for (const touch of resolveReach(part, reach).touches) {
    if (namedControlAnswersForItself && !touch.discarded) continue;
    if (touch.removed || touch.paragraphPropertiesOnly) continue;
    if (contentControlPropertiesOf(touch.control).dataBinding) return 'bound';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Forms protection: the document-scoped half of the same refusal
// ---------------------------------------------------------------------------

/**
 * Whether forms protection reaches a node, i.e. it is not inside a control and not in a
 * section that switched form protection off (`w:sectPr/w:formProt`, §17.6.7).
 *
 * Under `edit="forms"` the document is read-only EXCEPT inside form fields, which is the
 * inverse of a lock: the same refusal, resolved from the other direction.
 */
export function formsProtectionRefusal(
  part: OoxmlPart,
  settings: OoxmlPart | null | undefined,
  op: TreeDocOp,
  preferredFieldId?: string
): TreeOpRejection | null {
  if (!enforcesFormsProtection(settings)) return null;
  // Filling permission never grants permission to change a legacy field definition.
  if (op.op === 'setTextFormFieldDefault' && sectionProtectsForms(part, op.paragraphId))
    return 'locked';
  if (op.op === 'commitTextFormField') return validateCommitTextFormField(part, op);
  if (op.op === 'setLegacyCheckbox' || op.op === 'setLegacyDropdown') return null;
  const textField = textFormFieldForEdit(part, op, preferredFieldId);
  if (
    (op.op === 'insertText' || op.op === 'deleteText') &&
    op.textFormFieldId !== undefined &&
    !textField
  )
    return 'invalidArgs';
  if (textField && 'paragraphId' in op && sectionProtectsForms(part, op.paragraphId))
    return protectedTextFormEditRefusal(part, op, textField);
  if (
    (op.op === 'insertText' || op.op === 'deleteText') &&
    sectionProtectsForms(part, op.paragraphId)
  ) {
    const paragraph = findNode(part, op.paragraphId);
    if (paragraph?.kind === 'paragraph') {
      const start = op.op === 'insertText' ? op.offset : op.start;
      const end = op.op === 'insertText' ? op.offset : op.end;
      if (
        textFormFieldsOf(paragraph).some((field) =>
          op.op === 'insertText'
            ? start >= field.start && start <= field.end
            : start < field.end && end > field.start
        )
      )
        return 'locked';
    }
  }
  const reach = treeOpReach(op);
  if (reach.kind === 'none') return null;
  for (const node of resolveReach(part, reach).unprotected) {
    // A section may switch form protection back off (`w:sectPr/w:formProt`), and the part root
    // stands for a document-scoped op — which no section exempts.
    if (node !== part.root.id && !sectionProtectsForms(part, node)) continue;
    return 'locked';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Node construction
// ---------------------------------------------------------------------------

export function wmlElement(
  nextId: () => string,
  localName: string,
  options: {
    readonly kind?: OoxmlNode['kind'];
    readonly attributes?: readonly (readonly [string, string])[];
    readonly children?: readonly OoxmlNode[];
  } = {}
): OoxmlElement {
  return {
    id: nextId(),
    kind: options.kind ?? 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: (options.attributes ?? []).map(([name, value]) => ({
      kind: 'generic',
      namespaceUri: WML_NAMESPACE_URI,
      localName: name,
      prefix: 'w',
      value,
    })),
    children: options.children ?? [],
  } as unknown as OoxmlElement;
}

export function textRun(
  nextId: () => string,
  text: string,
  properties: OoxmlNode | undefined
): OoxmlNode {
  const content = textWithHyphens(nextId, text);
  return {
    id: nextId(),
    kind: 'run',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: properties ? [properties, ...content] : content,
  } as unknown as OoxmlNode;
}

export function cloneWithFreshIds(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { id: nextId(), kind: 'textValue', value: node.value };
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => cloneWithFreshIds(child, nextId)),
  } as OoxmlNode;
}

function withAttribute(node: OoxmlElement, localName: string, value: string): OoxmlElement {
  const existing = node.attributes.findIndex(
    (attribute) => attribute.localName === localName && attribute.namespaceUri !== ''
  );
  const attribute = {
    ...(existing >= 0
      ? node.attributes[existing]!
      : {
          kind: 'generic',
          namespaceUri: node.namespaceUri,
          localName,
          prefix: node.prefix,
        }),
    value,
  };
  const attributes =
    existing >= 0
      ? node.attributes.map((current, index) => (index === existing ? attribute : current))
      : [...node.attributes, attribute];
  return { ...node, attributes } as OoxmlElement;
}

function w14Attribute(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const attribute of node.attributes) {
    if (attribute.localName === localName && attribute.namespaceUri === W14_NAMESPACE_URI) {
      return attribute.value;
    }
  }
  return undefined;
}

function namedElementChild(
  parent: OoxmlNode | undefined,
  namespaceUri: string,
  localName: string
): OoxmlElement | undefined {
  if (!parent || parent.kind === 'textValue') return undefined;
  for (const child of parent.children as readonly OoxmlNode[]) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === namespaceUri && child.localName === localName) return child;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Value semantics
// ---------------------------------------------------------------------------

export interface PlannedValue {
  /** What the control's content becomes. */
  readonly text: string;
  /** Whether the control ends up showing its prompt. */
  readonly showingPlaceholder: boolean;
  /** Property edits to make on `w:sdtPr`, applied in place and re-ordered on write. */
  readonly lastValue?: string;
  readonly fullDate?: string;
  readonly checked?: boolean;
  readonly symbol?: CheckboxSymbol;
}

/**
 * The value in the vocabulary {@link planValue} reads, whichever form the caller offered.
 *
 * The op carries `string | ContentControlValueInput`. A bare string is the editor-facing form,
 * where the characters mean whatever the control's own type says they mean: an item's value for
 * a dropdown, an ISO date for a date picker, a checkbox state for a checkbox, text for the rest.
 * The structured form states the kind instead of implying it. Normalizing here keeps the two
 * forms from becoming two answers to "what is this control's value" — a string routed to one
 * applier and an object to another is already two code paths, and it must not be two meanings.
 */
function valueInputOf(
  properties: ContentControlProperties,
  value: string | ContentControlValueInput
): ContentControlValueInput | TreeOpRejection {
  if (typeof value !== 'string') return value;
  switch (properties.type) {
    case 'dropDownList':
      return { kind: 'listItem', value };
    case 'checkbox': {
      const checked = parseCheckboxValue(value);
      // Neither checked nor unchecked. Writing a glyph either way would be this engine deciding
      // what the caller meant about a box whose two states the file itself declares.
      return checked === null ? 'typeMismatch' : { kind: 'checkbox', checked };
    }
    case 'date':
      return { kind: 'date', iso: value };
    default:
      return { kind: 'text', text: value };
  }
}

export function planValue(
  properties: ContentControlProperties,
  value: ContentControlValueInput
): PlannedValue | TreeOpRejection {
  switch (value.kind) {
    case 'text': {
      if (
        properties.type !== 'richText' &&
        properties.type !== 'plainText' &&
        properties.type !== 'comboBox' &&
        properties.type !== 'untyped'
      ) {
        return 'typeMismatch';
      }
      if (typeof value.text !== 'string' || !isInsertableText(value.text)) return 'invalidArgs';
      if (value.text.includes(LINE_BREAK_TEXT) && !propertiesHoldLineBreaks(properties))
        return 'invalidArgs';
      if (value.text.length === 0) {
        return { text: promptFor(properties.type), showingPlaceholder: true };
      }
      return {
        text: value.text,
        showingPlaceholder: false,
        ...(properties.type === 'comboBox' ? { lastValue: value.text } : {}),
      };
    }
    case 'listItem': {
      if (properties.type !== 'dropDownList' && properties.type !== 'comboBox') {
        return 'typeMismatch';
      }
      const item = properties.listItems.find((candidate) => candidate.value === value.value);
      // A dropdown's whole contract is that its value is one the list declares; a combo box
      // reaches free text through `{ kind: 'text' }`, so an unknown ITEM is wrong there too.
      if (!item) return 'invalidArgs';
      return { text: item.displayText, showingPlaceholder: false, lastValue: item.value };
    }
    case 'checkbox': {
      if (properties.type !== 'checkbox' || !properties.checkbox) return 'typeMismatch';
      if (typeof value.checked !== 'boolean') return 'invalidArgs';
      const state = value.checked
        ? properties.checkbox.checkedState
        : properties.checkbox.uncheckedState;
      const glyph = glyphFor(state?.value, value.checked);
      if (glyph === null) return 'invalidArgs';
      return {
        text: glyph,
        showingPlaceholder: false,
        checked: value.checked,
        symbol: {
          hex: state?.value ?? (value.checked ? '2612' : '2610'),
          font: state?.font ?? 'MS Gothic',
          states: checkboxStateHexes(properties.checkbox),
        },
      };
    }
    case 'date': {
      if (properties.type !== 'date') return 'typeMismatch';
      const parsed = typeof value.iso === 'string' ? parseIsoDate(value.iso) : null;
      if (!parsed) return 'invalidArgs';
      const iso = `${String(parsed.year).padStart(4, '0')}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
      return {
        text: formatContentControlDate(parsed, properties.date?.dateFormat),
        showingPlaceholder: false,
        fullDate: `${iso}T00:00:00Z`,
      };
    }
    default:
      return 'invalidArgs';
  }
}

/** The glyph a checkbox state declares, as a character. Word's defaults when it declares none. */
function glyphFor(hex: string | undefined, checked: boolean): string | null {
  const raw = hex ?? (checked ? '2612' : '2610');
  if (!/^[0-9A-Fa-f]{1,6}$/.test(raw)) return null;
  const code = Number.parseInt(raw, 16);
  // A file-supplied code point is bounded before it reaches `fromCodePoint`, which throws on
  // anything past the Unicode range and would turn a malformed control into a crash.
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  return String.fromCodePoint(code);
}

// ---------------------------------------------------------------------------
// Property writing
// ---------------------------------------------------------------------------

interface PropertyEdits {
  readonly tag?: string | null;
  readonly alias?: string | null;
  readonly lock?: ContentControlLock;
  readonly id?: number;
  readonly showingPlaceholder?: boolean;
  readonly lastValue?: string;
  readonly fullDate?: string;
  readonly checked?: boolean;
  readonly temporary?: false;
}

/**
 * Rebuild `w:sdtPr` with the named edits applied, in schema order.
 *
 * Everything not named survives — including the unmodelled children (`w15:repeatingSection`, a
 * vendor extension) this change deliberately does not own — and the order is restored by
 * {@link orderedContentControlProperties} rather than by appending, because `CT_SdtPr` is a
 * sequence and Word rejects one out of order.
 */
export function editedProperties(
  sdtPr: OoxmlElement | undefined,
  edits: PropertyEdits,
  nextId: () => string
): OoxmlElement {
  const base =
    sdtPr ?? wmlElement(nextId, 'sdtPr', { kind: 'contentControlProperties' as OoxmlNode['kind'] });
  let children = [...base.children] as OoxmlNode[];

  const setSimple = (localName: string, value: string | null): void => {
    const index = children.findIndex(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === localName
    );
    if (value === null) {
      if (index >= 0) children.splice(index, 1);
      return;
    }
    const next = wmlElement(nextId, localName, { attributes: [['val', value]] });
    if (index >= 0) children[index] = next;
    else children.push(next);
  };
  const setFlag = (localName: string, on: boolean): void => {
    const index = children.findIndex(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === localName
    );
    if (!on) {
      if (index >= 0) children.splice(index, 1);
      return;
    }
    if (index < 0) children.push(wmlElement(nextId, localName));
  };

  if (edits.tag !== undefined) setSimple('tag', edits.tag);
  if (edits.alias !== undefined) setSimple('alias', edits.alias);
  if (edits.lock !== undefined) setSimple('lock', edits.lock === 'unlocked' ? null : edits.lock);
  if (edits.id !== undefined) setSimple('id', String(edits.id));
  if (edits.showingPlaceholder !== undefined) setFlag('showingPlcHdr', edits.showingPlaceholder);
  if (edits.temporary === false) setFlag('temporary', false);
  if (edits.lastValue !== undefined) {
    children = children.map((child) => {
      if (
        child.kind === 'textValue' ||
        child.namespaceUri !== WML_NAMESPACE_URI ||
        (child.localName !== 'dropDownList' && child.localName !== 'comboBox')
      ) {
        return child;
      }
      // An attribute cannot hold U+001E or U+001F, so it keeps the hyphens as they are seen.
      return withAttribute(child, 'lastValue', withDisplayedHyphens(edits.lastValue!));
    });
  }
  if (edits.fullDate !== undefined) {
    children = children.map((child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'date'
        ? withAttribute(child, 'fullDate', edits.fullDate!)
        : child
    );
  }
  if (edits.checked !== undefined) {
    children = children.map((child) => {
      if (
        child.kind === 'textValue' ||
        child.namespaceUri !== W14_NAMESPACE_URI ||
        child.localName !== 'checkbox'
      ) {
        return child;
      }
      const inner = child.children.map((grand) => {
        if (
          grand.kind === 'textValue' ||
          grand.namespaceUri !== W14_NAMESPACE_URI ||
          grand.localName !== 'checked'
        ) {
          return grand;
        }
        return {
          ...grand,
          attributes: grand.attributes.map((attribute) =>
            attribute.localName === 'val' && attribute.namespaceUri === W14_NAMESPACE_URI
              ? { ...attribute, value: edits.checked ? '1' : '0' }
              : attribute
          ),
        } as OoxmlNode;
      });
      return { ...child, children: inner } as OoxmlNode;
    });
  }

  return { ...base, children: orderedContentControlProperties(children) } as OoxmlElement;
}

/** Rebuild a control's content so it holds exactly `text`, keeping its block shape. */
export function contentWithText(
  content: OoxmlElement | undefined,
  text: string,
  nextId: () => string,
  inline: boolean,
  preferredParagraphId?: string
): readonly OoxmlNode[] | null {
  return valueContent(
    content,
    (properties) => textRun(nextId, text, properties),
    nextId,
    inline,
    preferredParagraphId
  );
}

export function contentControlEffect(
  controlId: string,
  impact: TreeOpEffect['impact']
): TreeOpEffect {
  return {
    dirty: [controlId],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact,
  };
}

// ---------------------------------------------------------------------------
// Appliers
// ---------------------------------------------------------------------------

function resolveControl(
  part: OoxmlPart,
  controlId: string
): { control: OoxmlElement; lock: ContentControlLock } | TreeOpRejection {
  const node = findNode(part, controlId);
  if (!node) return 'unknown-content-control';
  if (node.kind !== 'contentControl') return 'not-a-content-control';
  return { control: node, lock: contentControlLockAt(part, controlId) };
}

export function applySetContentControlValue(
  part: OoxmlPart,
  op: Extract<TreeDocOp, { op: 'setContentControlValue' }>,
  options?: EditOptions
): TreeOpResult {
  const resolved = resolveControl(part, op.controlId);
  if (typeof resolved === 'string') return { ok: false, reason: resolved };
  const { control, lock } = resolved;
  const properties = contentControlPropertiesOf(control);
  if (properties.dataBinding) return { ok: false, reason: 'bound' };
  if (lockForbidsEdit(lock)) return { ok: false, reason: 'locked' };

  const offered = valueInputOf(properties, op.value);
  if (typeof offered === 'string') return { ok: false, reason: offered };
  const planned = planValue(properties, offered);
  if (typeof planned === 'string') return { ok: false, reason: planned };

  const nextId = createNodeIdAllocator(part);
  const sdtPr = contentControlPropertiesContainerOf(control);
  // By name, not by kind: a `w:sdtContent` holding a child outside its typed set (a simple
  // field, say) demotes to generic, and must still be the one content node the write replaces.
  const content = contentControlContentOf(control);
  const inline = isInlineControl(part, control.id);
  const children = planned.symbol
    ? checkboxContent(content, planned.symbol, planned.text, nextId, inline)
    : contentWithText(content, planned.text, nextId, inline);
  if (!children) return { ok: false, reason: 'unsupported' };
  const nextProperties = editedProperties(
    sdtPr,
    {
      showingPlaceholder: planned.showingPlaceholder,
      ...(planned.lastValue === undefined ? {} : { lastValue: planned.lastValue }),
      ...(planned.fullDate === undefined ? {} : { fullDate: planned.fullDate }),
      ...(planned.checked === undefined ? {} : { checked: planned.checked }),
    },
    nextId
  );
  const nextContent = {
    ...(content ??
      wmlElement(nextId, 'sdtContent', { kind: 'contentControlContent' as OoxmlNode['kind'] })),
    children,
  } as OoxmlNode;

  const rebuilt = {
    ...control,
    children: [
      nextProperties,
      ...control.children.filter((child) => child.id !== sdtPr?.id && child.id !== content?.id),
      nextContent,
    ],
  } as OoxmlNode;

  const written = replaceNode(part, control.id, rebuilt, options);
  if (!written.ok) {
    return { ok: false, reason: 'tree-invariant', detail: JSON.stringify(written.issues) };
  }
  // `w:temporary`: the control goes once its content has been edited, and the content stays.
  // The other half of the placeholder transition — a prompt that was only ever a prompt.
  if (properties.temporary) {
    return applyRemoveContentControl(
      written.part,
      { op: 'removeContentControl', controlId: control.id, keepContent: true },
      options
    );
  }
  return {
    ok: true,
    part: written.part,
    // Paragraphs the value dropped, minted or kept in place are reported to paragraph-keyed
    // consumers.
    effect: withParagraphDiff(
      contentControlEffect(control.id, 'flow-structural'),
      control,
      rebuilt
    ),
  };
}

export function applySetContentControlProperties(
  part: OoxmlPart,
  op: Extract<TreeDocOp, { op: 'setContentControlProperties' }>,
  options?: EditOptions
): TreeOpResult {
  const resolved = resolveControl(part, op.controlId);
  if (typeof resolved === 'string') return { ok: false, reason: resolved };
  const { control, lock } = resolved;
  // A control's own lock protects its content/existence, not the ability to change
  // that lock. Retain every ancestor's protection when toggling the named control.
  const lockOnly = op.lock !== undefined && op.tag === undefined && op.alias === undefined;
  const effective = lockOnly
    ? resolveContentControlLock(
        enclosingContentControls(part, control.id)
          .slice(0, -1)
          .map((ancestor) => contentControlPropertiesOf(ancestor).lock)
      )
    : lock;
  if (lockForbidsEdit(effective) || lockForbidsRemoval(effective))
    return { ok: false, reason: 'locked' };

  const nextId = createNodeIdAllocator(part);
  const properties = contentControlPropertiesContainerOf(control);
  const nextProperties = editedProperties(
    properties,
    {
      ...(op.tag === undefined ? {} : { tag: op.tag }),
      ...(op.alias === undefined ? {} : { alias: op.alias }),
      ...(op.lock === undefined ? {} : { lock: op.lock }),
    },
    nextId
  );
  const children = [
    nextProperties,
    ...control.children.filter((child) => child.id !== properties?.id),
  ];
  return fromEdit(
    replaceNode(part, control.id, { ...control, children } as OoxmlNode, options),
    contentControlEffect(control.id, 'paragraph-local')
  );
}

export function applyRemoveContentControl(
  part: OoxmlPart,
  op: Extract<TreeDocOp, { op: 'removeContentControl' }>,
  options?: EditOptions
): TreeOpResult {
  const resolved = resolveControl(part, op.controlId);
  if (typeof resolved === 'string') return { ok: false, reason: resolved };
  const { control, lock } = resolved;
  if (lockForbidsRemoval(lock)) return { ok: false, reason: 'locked' };
  // An enclosing content lock is refused in `validateRemoveContentControl`, for every form.
  // Deleting the WHOLE control is an existence operation, governed by the wrapper axis
  // alone — Word deletes a contentLocked control whole (only sdtLocked forbids deletion),
  // and Backspace over a content-locked chip relies on it. The content lock guards the
  // characters while the control exists, not the control's existence.

  const owner = parentOf(part, control.id);
  if (!owner) return { ok: false, reason: 'tree-invariant' };
  const content = contentControlContentNodeOf(control);
  const kept = op.keepContent && content ? [...content.children] : [];
  // A story that ends with a paragraph keeps it: a whole control after a final table goes only
  // with block content kept (`ooxml-story-end-repair.ts`).
  if (
    !kept.some(holdsStoryBlock) &&
    removalEndsStoryWithTable(control.id, (id) => parentNodeOf(part, id))
  ) {
    return { ok: false, reason: 'story-end-paragraph' };
  }
  const children = owner.children.flatMap((child) => (child.id === control.id ? kept : [child]));
  // A control proposed as a tracked insertion goes with its `w:ins` when nothing else is in it:
  // an empty wrapper would stay behind as a review item with nothing to accept or reject.
  const outer =
    children.length === 0 && owner.kind === 'revisionInsert' && parentOf(part, owner.id);
  if (outer) {
    return fromEdit(
      replaceChildren(
        part,
        outer.id,
        outer.children.filter((child) => child.id !== owner.id),
        options
      ),
      contentControlEffect(outer.id, 'flow-structural')
    );
  }
  return fromEdit(
    replaceChildren(part, owner.id, children, options),
    contentControlEffect(owner.id, 'flow-structural')
  );
}

// ---------------------------------------------------------------------------
// Placeholder replacement on an ordinary edit
// ---------------------------------------------------------------------------

/**
 * The control whose PROMPT an insertion at this position would type over, if any.
 *
 * A prompt is state rather than text, so the first character typed replaces the whole of it —
 * appending to it is the defect this change exists to fix, and it is the store's job because
 * the caret is not the only thing that can insert.
 */
export function placeholderControlForInsertion(
  part: OoxmlPart,
  paragraphId: string,
  offset: number
): { readonly control: OoxmlNode; readonly offset: number } | null {
  const chain = enclosingContentControls(part, paragraphId);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const control = chain[index]!;
    if (contentControlPropertiesOf(control).showingPlaceholder) return { control, offset: 0 };
  }
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;
  const index = paragraphOffsetIndex(paragraph);
  for (const entry of contentControlsIn(paragraph)) {
    if (!contentControlPropertiesOf(entry.node).showingPlaceholder) continue;
    const span = index.spanOf(entry.node);
    if (!span) continue;
    if (offset >= span.start && offset <= span.end)
      return { control: entry.node, offset: span.start };
  }
  return null;
}

/** Empty a control's prompt and clear the flag, so the caller's insert is the whole content. */
export function clearPlaceholder(
  part: OoxmlPart,
  controlId: string,
  options?: EditOptions,
  /** The paragraph the caller is about to write into, kept as the emptied prompt's paragraph. */
  preferredParagraphId?: string
): OoxmlPart | null {
  const control = findNode(part, controlId);
  if (!control || control.kind !== 'contentControl') return null;
  const nextId = createNodeIdAllocator(part);
  const content = contentControlContentOf(control);
  const sdtPr = contentControlPropertiesContainerOf(control);
  const properties = editedProperties(sdtPr, { showingPlaceholder: false }, nextId);
  const inline = isInlineControl(part, control.id);
  const children = contentWithText(content, '', nextId, inline, preferredParagraphId);
  if (!children) return null;
  const emptied = {
    ...(content ??
      wmlElement(nextId, 'sdtContent', { kind: 'contentControlContent' as OoxmlNode['kind'] })),
    children,
  } as OoxmlNode;
  const rebuilt = {
    ...control,
    children: [
      properties,
      ...control.children.filter((child) => child.id !== sdtPr?.id && child.id !== content?.id),
      emptied,
    ],
  } as OoxmlNode;
  const written = replaceNode(part, control.id, rebuilt, options);
  return written.ok ? written.part : null;
}

/** Whether a metadata string is short enough and legal in XML. */
export function isWritableContentControlMetadata(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string' || value.length > MAX_METADATA_LENGTH) return false;
  return isValidXmlText(value);
}

export {
  namedElementChild as contentControlChildElement,
  w14Attribute as contentControlW14Attribute,
};
