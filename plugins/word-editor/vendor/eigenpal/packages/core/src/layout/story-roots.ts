import { isUnsupportedLayoutParagraph, unsupportedBlockParagraph } from './unsupported-content.ts';
import { currentFieldResultsMode } from '../store/package/field-result-mode.ts';
import { tocCodeRanges } from './field-code-toc.ts';
import { holdsFieldBoundary, inBodyToc } from '../store/package/toc-detect.ts';
import { tocFieldChromeParagraphIds, emptyTocSuppressedResultParagraphIds } from './toc-layout.ts';
import type { NumberingIndex } from './numbering-index.ts';
import { withStyleSeparatorParagraphs } from './style-separator-flow.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
// Story roots over the canonical tree (phase 2 of the legacy-lane retirement).
//
// A STORY is a flowable sequence of blocks: the body of the main document, the whole
// content of a header/footer part (`w:hdr`/`w:ftr` roots hold block content directly),
// or a single footnote/endnote node. This is the single place that knows which roots
// flow and how block-level content controls flatten — via shared `collectFlowBlocks`.
//
// SDT content flattens TRANSPARENTLY: the paragraphs and tables inside `w:sdtContent`
// join the flow in reading order (Word renders them in place), while the `w:sdt` wrapper
// itself stays structurally preserved for serialization. SDT chrome — placeholder text,
// locks, dropdown behaviour — is not modelled here.
//
// Note parts (`w:footnotes` / `w:endnotes`) are NOT story roots: each typed `w:footnote` /
// `w:endnote` child is its own story via {@link noteStoryBlocks}.

import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlParagraphNode,
  OoxmlPart,
} from '@docx-editor.dev/core/store';
import { MAX_CONTENT_CONTROL_NESTING } from '../store/package/content-control-walk.ts';
import { blockStoryContainerChildren } from '../store/package/story-blocks.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import { piecesOfParagraph } from './field-projection.ts';
import { createRecentRootCache } from '../store/store/recent-root-cache.ts';
import {
  revisionFilterSelects,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import { cacheProjection } from './bounded-projection-cache.ts';
import { markRemovedInMode, revisionRemovesParagraph } from './revision-visibility.ts';
import { carryNumberingFlow, withoutHiddenMarkParagraphs } from './hidden-paragraph-mark.ts';
import { projectRevisionFormatting } from './revision-formatting-projection.ts';
import { weakRefOf, type WeakRefOf } from '../store/package/weak-ref.ts';

export { MAX_CONTENT_CONTROL_NESTING as MAX_SDT_NESTING } from '../store/package/content-control-walk.ts';

/** Roots whose children are block content: the body, and header/footer part roots. */
function storyRootOf(part: OoxmlPart): OoxmlElement | undefined {
  const root = part.root;
  if (root.localName === 'hdr' || root.localName === 'ftr') return root;
  const findBody = (node: OoxmlNode): OoxmlElement | undefined => {
    if (node.kind === 'textValue') return undefined;
    if (node.kind === 'body') return node;
    for (const child of node.children) {
      const found = findBody(child);
      if (found) return found;
    }
    return undefined;
  };
  return findBody(root);
}

function acceptStoryBlock(
  block: OoxmlElement,
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): boolean {
  // A paragraph whose mark AND content a tracked revision deleted is not part of the
  // rendered document; without this it reaches pagination with no spans and still
  // claims a full line box.
  if (block.kind === 'paragraph' && revisionRemovesParagraph(block, displayMode, authorFilter))
    return false;
  return true;
}

/**
 * The paragraphs a merge group is built from, in order, with the survivor last.
 *
 * Published beside the synthetic paragraph rather than derived from it, because the identity
 * rewrite has to name the member a piece of content came from and a synthetic node has lost
 * that by construction.
 */
export interface ParagraphMergeGroup {
  /** The node layout lays out: the survivor's properties, every member's content. */
  readonly merged: OoxmlElement;
  /** Members in document order. The last one is the survivor whose mark stays. */
  readonly members: readonly OoxmlElement[];
}

/** Groups keyed by the synthetic node, so a caller holding one can ask what it came from. */
const mergeGroups = new WeakMap<OoxmlElement, ParagraphMergeGroup>();

/** The members a laid-out paragraph stands for, or null when it stands for itself. */
export function paragraphMergeGroupOf(paragraph: OoxmlElement): ParagraphMergeGroup | null {
  return mergeGroups.get(paragraph) ?? null;
}

/** One paragraph standing for several: the survivor's properties, every member's content. */
function mergedParagraph(members: readonly OoxmlElement[], survivor: OoxmlElement): OoxmlElement {
  const properties = survivor.children.filter((child) => isParagraphProperties(child));
  const content = members.flatMap((member) =>
    member.children.filter((child) => !isParagraphProperties(child))
  );
  const merged = { ...survivor, children: [...properties, ...content] } as OoxmlElement;
  mergeGroups.set(merged, { merged, members });
  return merged;
}

function isParagraphProperties(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' && (node.kind === 'paragraphProperties' || node.localName === 'pPr')
  );
}

/**
 * Fold each run of mark-removed paragraphs into the paragraph that follows it.
 *
 * The shape matches `resolveRevisions` exactly: the SURVIVOR's `w:pPr` governs, and every
 * member's content arrives before it in document order. A trailing member with nothing to
 * merge into keeps itself, for the same reason the store refuses that case — its runs have no
 * paragraph to live in.
 */
function withMergedParagraphs(
  parented: readonly ParentedBlock[],
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): readonly ParentedBlock[] {
  if (displayMode === 'all-markup' && !revisionFilterSelects(authorFilter)) return parented;
  const out: ParentedBlock[] = [];
  let pendingMembers: OoxmlElement[] = [];
  let pendingParent: string | null = null;
  const endRun = (): void => {
    const parentKey = pendingParent ?? '';
    for (const block of mergedTrailingRun(pendingMembers)) out.push({ block, parentKey });
    pendingMembers = [];
    pendingParent = null;
  };
  for (const entry of parented) {
    const { block, parentKey } = entry;
    // A content control flattens into the flow, so its paragraphs are neighbours on the page
    // without being siblings in the tree. The store rebuilds one children array at a time and
    // never merges out of `w:sdtContent`; matching that keeps the two answers the same.
    if (pendingMembers.length > 0 && parentKey !== pendingParent) endRun();
    if (block.kind !== 'paragraph' || isUnsupportedLayoutParagraph(block)) {
      // A table between two mark-removed paragraphs is a container boundary too.
      endRun();
      out.push(entry);
      continue;
    }
    const removed = markRemovedInMode(block, displayMode, authorFilter);
    // Measuring costs a walk of the paragraph, so it is asked ONLY where a merge could happen:
    // of a paragraph whose mark is removed, and of the survivor a pending run would merge into.
    // A document with no tracked marks answers `false` to the cheap question and stops, which
    // is every keystroke in the view the free engine renders by default.
    if (
      (removed || pendingMembers.length > 0) &&
      !memberIsAddressable(block, displayMode, authorFilter)
    ) {
      // Cannot be measured, so cannot be merged INTO either: a survivor whose own offsets do
      // not line up would take the previous members' characters at the wrong index.
      endRun();
      out.push(entry);
      continue;
    }
    if (removed) {
      pendingMembers.push(block);
      pendingParent = parentKey;
      continue;
    }
    if (pendingMembers.length === 0) {
      out.push(entry);
      continue;
    }
    const members = [...pendingMembers, block];
    pendingMembers = [];
    pendingParent = null;
    out.push({ block: mergedParagraph(members, block), parentKey });
  }
  // A TRAILING run, with no unmarked paragraph after it. Word cannot delete the last mark of a
  // story, so the last member keeps its own break and the ones before it still merge into it —
  // which is what `resolveRevisions` does, one member at a time, for the same reason.
  endRun();
  return out;
}

function mergedTrailingRun(members: readonly OoxmlElement[]): readonly OoxmlElement[] {
  if (members.length < 2) return members;
  const survivor = members[members.length - 1]!;
  return [mergedParagraph(members, survivor)];
}

/**
 * One container's blocks: flattened through content controls, merged, then filtered.
 *
 * MERGE FIRST, then drop. A mark-removed paragraph merges into the paragraph that follows it
 * IN THE TREE, which is the rule `resolveRevisions` follows; dropping the empty ones first
 * would hand a member the wrong survivor, and the survivor's properties govern the result.
 * After the merge the drop has little left to do: an absorbed member is gone already, and what
 * remains is a mark-removed paragraph with nothing after it to merge into.
 *
 * Every story collects its blocks through here — body, note, textbox and table cell — so a
 * container is a merge boundary by construction: a paragraph can only merge with one that
 * shares its parent, which is the same rule the store applies.
 *
 * Last, an empty paragraph whose mark is hidden leaves the flow; see `hidden-paragraph-mark.ts`.
 */
export function mergedFlowBlocks(
  children: readonly OoxmlNode[],
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter,
  styles?: StyleCascadeTable,
  styleSeparators = false,
  numberingIndex?: NumberingIndex,
  excludedParagraphs?: ReadonlySet<string> | (() => ReadonlySet<string>)
): OoxmlElement[] {
  const blocks = flowBlocksWithParent(children).map((entry) => ({
    ...entry,
    block: projectRevisionFormatting(entry.block, displayMode, authorFilter),
  }));
  const revisionBlocks = withMergedParagraphs(blocks, displayMode, authorFilter).filter((entry) =>
    acceptStoryBlock(entry.block, displayMode, authorFilter)
  );
  const accepted = styleSeparators
    ? withStyleSeparatorParagraphs(
        revisionBlocks,
        styles,
        numberingIndex,
        excludedParagraphs,
        (block) => memberIsAddressable(block, displayMode, authorFilter),
        (block) => mergeGroups.has(block),
        (merged, members) => mergeGroups.set(merged, { merged, members })
      )
    : revisionBlocks;
  // A merged paragraph's identity keys its merge group, so it is never copied.
  return withoutHiddenMarkParagraphs(
    accepted,
    displayMode,
    authorFilter,
    (block) => !mergeGroups.has(block)
  );
}

/**
 * The elements Word writes beside a cell-terminating `w:p` that paint nothing.
 *
 * Anything else — a run, a `w:ins`, a `w:hyperlink` — is content, and a paragraph holding
 * it keeps its line box wherever it sits.
 */
const CELL_TERMINATOR_MARKERS = new Set([
  'pPr',
  'bookmarkStart',
  'bookmarkEnd',
  'proofErr',
  'permStart',
  'permEnd',
]);

/**
 * Does this paragraph carry nothing but properties and structural markers?
 *
 * A `w:tc` must end with a `w:p` (ECMA-376 Part 1 §17.4.65), so a cell whose last real block
 * is a `w:tbl` still carries one, written empty. That paragraph gets no line box; charging
 * one for it makes the cell — and with it the row — a full line taller than it should be. The paragraph stays in the flow so the caret and select-all can
 * still reach it, and only its HEIGHT collapses; see `placeCellParagraph`.
 *
 * A paragraph with content keeps its height, and so does an empty paragraph anywhere else
 * in the cell: the rule is about the terminator a trailing nested table forces.
 */
export function isEmptyCellTerminator(paragraph: OoxmlElement): boolean {
  return paragraph.children.every(isCellTerminatorMarker);
}

/** An empty text value, or an element beside a cell-terminating `w:p` that paints nothing. */
export function isCellTerminatorMarker(child: OoxmlNode): boolean {
  if (child.kind === 'textValue') return child.value.length === 0;
  return child.namespaceUri === WML_NAMESPACE_URI && CELL_TERMINATOR_MARKERS.has(child.localName);
}

/** A block, and which children array it actually lives in. */
interface ParentedBlock {
  readonly block: OoxmlElement;
  /** Node id of the enclosing transparent wrapper, or `''` for the story root's own children. */
  readonly parentKey: string;
}

/** The walk `collectFlowBlocks` performs, remembering where each block CAME FROM. */
function flowBlocksWithParent(children: readonly OoxmlNode[]): readonly ParentedBlock[] {
  const blocks: ParentedBlock[] = [];
  const collect = (nodes: readonly OoxmlNode[], nest: number, parentKey: string): void => {
    for (const child of nodes) {
      if (child.kind === 'textValue') continue;
      const opaque = unsupportedBlockParagraph(child);
      if (opaque) {
        blocks.push({ block: opaque, parentKey });
        continue;
      }
      if (child.kind === 'paragraph' || child.kind === 'table') {
        blocks.push({ block: child, parentKey });
        continue;
      }
      const nested = blockStoryContainerChildren(child);
      if (nested !== null && nest < MAX_CONTENT_CONTROL_NESTING) {
        collect(nested, nest + 1, child.id);
      }
    }
  };
  collect(children, 0, '');
  return blocks;
}

/**
 * Can this paragraph's content be addressed inside a merged one?
 *
 * ASK THE WALK, which is what the design called for. A member's characters are placed in the
 * merged paragraph at an offset taken from the STORE and read back out of spans the LAYOUT
 * walk produced, so the two have to agree about how long the member is. They agree for every
 * ordinary construct and part ways in two places: a field whose `w:fldChar begin` sits in one
 * member and whose `end` sits in the next — Word writes that for a TOC — closes across the
 * mark once the members share a paragraph and swallows the second member into one atomic
 * field; and content past a nesting cap counts differently on each side. Both publish one
 * member's text at another member's offsets, which is worse than the break this change exists
 * to remove, so a group that cannot be measured is not merged.
 *
 * A refusal is fail-visible, not fail-safe: the reader keeps a break the document says is
 * gone, and if the refused member carried `w:pPr/w:sectPr` they also keep a section break —
 * so the pages before it stay at their own paper size, where accepting the change would put
 * them on the next section's.
 */
/**
 * Memoized on the node, per mode. A paragraph is immutable — a transaction rebuilds the path
 * to what it edited and leaves every other paragraph object-identical — so the answer holds
 * until that paragraph itself changes. Without this the walk ran for every candidate on every
 * flush, and a document with hundreds of tracked marks paid it on each keystroke.
 */
const addressableByNode = new WeakMap<OoxmlElement, Map<string, boolean>>();

function memberIsAddressable(
  member: OoxmlElement,
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): boolean {
  const key = `${displayMode}|${authorFilter?.cacheKey ?? ''}|${currentFieldResultsMode()}`;
  const perMode = addressableByNode.get(member);
  const cached = perMode?.get(key);
  if (cached !== undefined) return cached;
  const answer = measureMember(member, displayMode, authorFilter);
  if (perMode) cacheProjection(perMode, key, answer);
  else addressableByNode.set(member, new Map([[key, answer]]));
  return answer;
}

function measureMember(
  member: OoxmlElement,
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): boolean {
  if (!fieldCharsBalanced(member)) return false;
  const pieces = piecesOfParagraph(
    member,
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    displayMode,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    authorFilter
  );
  let published = 0;
  for (const piece of pieces) published = Math.max(published, piece.end);
  // Published LESS than the store holds is ordinary: a resolved view hides content it has
  // resolved away, and the walk still counts those characters in its offsets. Published MORE
  // is the failure — it means the walk reached content the store cannot address, so a member
  // placed after it would be read back at offsets that belong to no paragraph.
  return published <= paragraphOffsetIndex(member as OoxmlParagraphNode).length;
}

/**
 * Does every field this paragraph opens also close inside it?
 *
 * `w:fldChar begin` in one paragraph and `end` in the next is ordinary Word output — a TOC is
 * written that way. Two such paragraphs laid out as ONE close the field across the mark, and
 * the field projection then covers the whole of the second member with a single atomic offset:
 * every character of it published inside the first member's range, and the paragraph itself
 * unreachable. Merging is refused rather than made to look right.
 */
function fieldCharsBalanced(paragraph: OoxmlElement): boolean {
  let open = 0;
  let underflowed = false;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'fldChar') {
      const type = node.attributes.find(
        (attribute) => attribute.localName === 'fldCharType'
      )?.value;
      if (type === 'begin') open += 1;
      else if (type === 'end') {
        open -= 1;
        // An `end` with no `begin` in this paragraph closes a field that started in an
        // earlier one. Counting a net would let it cancel a later `begin` and call the
        // paragraph balanced, which is the case this guard exists to catch.
        if (open < 0) underflowed = true;
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(paragraph);
  return open === 0 && !underflowed;
}

/**
 * Memoized per part identity: parts are immutable (edits publish a new part object), so
 * the block list is a pure function of `(part, displayMode)`. Every keystroke flush asks
 * for the body's blocks from several callers — layout, section enumeration, furniture,
 * note pagination — and this walk ran fresh for each of them. A bounded WeakRef ring
 * rather than a plain WeakMap because undo history retains package snapshots by
 * reference; 16 slots cover one flush's parts (body + header/footer variants + notes).
 * Callers treat the result as read-only, so a shared array is safe to hand out.
 */
const storyBlocksCache = createRecentRootCache<Map<string, OoxmlElement[]>>(16);

const numberingIdentities = new WeakMap<NumberingIndex, number>();
let nextNumberingIdentity = 1;
function numberingIdentity(index?: NumberingIndex): number {
  if (!index) return 0;
  let id = numberingIdentities.get(index);
  if (!id) {
    id = nextNumberingIdentity++;
    numberingIdentities.set(index, id);
  }
  return id;
}

/** A story's last block list, with the children it came from (weakly) and block positions. */
interface LastBlocks {
  /** Both weakly: a kept list must not keep a closed or reloaded document's tree alive. */
  readonly children: WeakRefOf<readonly OoxmlNode[]>;
  readonly blocks: WeakRefOf<OoxmlElement[]>;
  positions?: Map<string, number>;
}
const lastBlocks = new Map<string, LastBlocks>();
const MAX_LAST_BLOCKS = 32;

function rememberBlocks(
  key: string,
  children: readonly OoxmlNode[],
  blocks: OoxmlElement[],
  positions?: Map<string, number>
): void {
  lastBlocks.delete(key);
  lastBlocks.set(key, {
    children: weakRefOf(children),
    blocks: weakRefOf(blocks),
    ...(positions ? { positions } : {}),
  });
  if (lastBlocks.size > MAX_LAST_BLOCKS) lastBlocks.delete(lastBlocks.keys().next().value!);
}

const paragraphProperties = (paragraph: OoxmlElement): OoxmlNode | undefined =>
  paragraph.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'pPr'
  );

/** Mark properties that let a paragraph join, leave or vanish from the flow by its neighbours. */
const FLOW_MARK_RULES: ReadonlySet<string> = new Set([
  'vanish',
  'specVanish',
  'webHidden',
  'del',
  'ins',
  'moveFrom',
  'moveTo',
]);

/** Whether a paragraph's mark carries a rule that depends on the blocks around it. */
function markReachesNeighbours(properties: OoxmlNode | undefined): boolean {
  if (!properties || properties.kind === 'textValue') return false;
  const mark = properties.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'rPr'
  );
  if (!mark || mark.kind === 'textValue') return false;
  return mark.children.some(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      FLOW_MARK_RULES.has(child.localName)
  );
}

/** Changed children past this many lay the story's blocks out again. */
const MAX_CARRIED_CHANGES = 8;

/**
 * The previous block list with each edited paragraph's block swapped in, when the edit cannot
 * have changed anything else. A keystroke makes a new story root whose children are the
 * previous objects but the edited paragraph, and the whole list was built again per keystroke.
 *
 * Every rule that reaches past one paragraph (a removed mark merging into the next, a style
 * separator, a hidden mark leaving the flow when a block follows) reads the paragraph's mark
 * from its `w:pPr`. An edited paragraph qualifies only with the same `w:pPr` object and a mark
 * that carries none of those rules. A table of contents hides paragraphs by what its field
 * holds, so a paragraph that holds a field character or sits in one does not qualify either. Its old and new block must each be what the paragraph
 * produces on its own, and the old one must stand unmerged in the previous list. Anything
 * else builds the list again. Tables are merge boundaries; replacing one visible table
 * with another under the same id cannot change its neighbours. The isolated projection
 * checks below still reject a table whose visibility changes.
 */
function carriedBlocks(
  key: string,
  children: readonly OoxmlNode[],
  flow: (children: readonly OoxmlNode[]) => OoxmlElement[],
  reachesFields: (before: OoxmlElement, after: OoxmlElement) => boolean
): OoxmlElement[] | undefined {
  const last = lastBlocks.get(key);
  const previous = last?.children.deref();
  const lastList = last?.blocks.deref();
  if (!last || !previous || !lastList || previous.length !== children.length) return undefined;
  const changed: number[] = [];
  for (let index = 0; index < children.length; index += 1) {
    if (children[index] === previous[index]) continue;
    if (changed.length >= MAX_CARRIED_CHANGES) return undefined;
    changed.push(index);
  }
  if (changed.length === 0) return lastList;
  let positions = last.positions;
  if (!positions) {
    positions = new Map();
    for (const [index, block] of lastList.entries()) positions.set(block.id, index);
    last.positions = positions;
  }
  const blocks = [...lastList];
  const replaced = new Map<OoxmlElement, OoxmlElement>();
  for (const index of changed) {
    const before = previous[index]!;
    const after = children[index]!;
    if (
      before.id !== after.id ||
      !(
        (before.kind === 'table' && after.kind === 'table') ||
        (before.kind === 'paragraph' &&
          after.kind === 'paragraph' &&
          paragraphProperties(before) === paragraphProperties(after) &&
          !markReachesNeighbours(paragraphProperties(after)) &&
          !reachesFields(before, after))
      )
    )
      return undefined;
    const position = positions.get(before.id);
    if (position === undefined) return undefined;
    const alone = flow([before]);
    if (alone.length !== 1 || alone[0] !== lastList[position]) return undefined;
    const replacement = flow([after]);
    if (replacement.length !== 1 || replacement[0]!.id !== after.id) return undefined;
    replaced.set(lastList[position]!, replacement[0]!);
    blocks[position] = replacement[0]!;
  }
  carryNumberingFlow(lastList, blocks, replaced);
  // The ids stand at the same places, so the positions carry over.
  rememberBlocks(key, children, blocks, positions);
  return blocks;
}

/**
 * Return story blocks in document order, flattening block-level content controls.
 * Compatible hidden paragraph marks join in body stories using the supplied styles and numbering.
 * Repeated calls with the same part and projection inputs share one array. Treat it as read-only.
 *
 * @public
 */
export function storyBlocks(
  part: OoxmlPart,
  displayMode: RevisionDisplayMode = 'all-markup',
  authorFilter?: RevisionAuthorFilter,
  styles?: StyleCascadeTable,
  numberingIndex?: NumberingIndex
): OoxmlElement[] {
  const key = `${displayMode}|${authorFilter?.cacheKey ?? ''}|${styles?.cacheToken ?? ''}|${numberingIdentity(numberingIndex)}`;
  const perMode = storyBlocksCache.get(part);
  const cached = perMode?.get(key);
  if (cached) return cached;
  const root = storyRootOf(part);
  let blocks: OoxmlElement[] = [];
  if (root) {
    const flow = (children: readonly OoxmlNode[]) =>
      mergedFlowBlocks(
        children,
        displayMode,
        authorFilter,
        styles,
        root.kind === 'body',
        numberingIndex,
        () =>
          new Set([
            ...tocCodeRanges(part).keys(),
            ...tocFieldChromeParagraphIds(part),
            ...emptyTocSuppressedResultParagraphIds(part),
          ])
      );
    const lastKey = `${part.name}\u0000${key}`;
    const reachesFields = (before: OoxmlElement, after: OoxmlElement) =>
      holdsFieldBoundary(before) ||
      holdsFieldBoundary(after) ||
      (root.kind === 'body' && inBodyToc(part, after.id));
    const carried = carriedBlocks(lastKey, root.children, flow, reachesFields);
    blocks = carried ?? flow(root.children);
    if (!carried) rememberBlocks(lastKey, root.children, blocks);
  }
  if (perMode) cacheProjection(perMode, key, blocks);
  else storyBlocksCache.set(part, new Map([[key, blocks]]));
  return blocks;
}

/**
 * Blocks of one typed footnote/endnote node — a separate semantic story root.
 *
 * The footnotes/endnotes part root is never a story; each note is laid out independently
 * so line ids and incremental convergence stay namespaced by note identity.
 */
export function noteStoryBlocks(
  note: OoxmlNode,
  displayMode: RevisionDisplayMode = 'all-markup',
  authorFilter?: RevisionAuthorFilter
): OoxmlElement[] {
  if (note.kind !== 'note') return [];
  return mergedFlowBlocks(note.children, displayMode, authorFilter);
}

/**
 * Blocks of one `w:txbxContent` node — the story inside a text-box drawing.
 *
 * Like a note, a textbox is its own story root laid out independently of the part that
 * hosts the drawing, so line ids and incremental convergence stay namespaced by drawing
 * identity.
 */
export function textboxStoryBlocks(
  content: OoxmlNode,
  displayMode: RevisionDisplayMode = 'all-markup',
  authorFilter?: RevisionAuthorFilter
): OoxmlElement[] {
  if (content.kind === 'textValue') return [];
  return mergedFlowBlocks(content.children, displayMode, authorFilter);
}
