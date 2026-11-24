// Removing a table of contents: the field from its begin marker to its end marker, or the
// table of contents control that holds the field and its heading.
//
// A table of contents field spans paragraphs, so no text deletion can remove it: its hidden
// markers take no offsets, and a deletion that empties the visible rows leaves a live field
// with no result. This op names the table of contents and takes the whole structure out.
//
// Range markers (bookmarks, comment ranges, permissions, move ranges) keep their pairs: a pair
// wholly inside the removed content goes with it, and a marker whose partner stays outside
// moves to the point of the cut, so no range is left with one end.

import {
  detectBodyTocs,
  findDetectedToc,
  holdsFieldBoundary,
  tocFieldRange,
  type DetectedToc,
} from '../package/toc-detect.ts';
import {
  applyEdits,
  createNodeIdAllocator,
  findNode,
  removeNode,
  replaceNode,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { MAX_INLINE_CONTAINER_DEPTH, nextInlineContainerDepth } from '../package/ooxml-shared.ts';
import { paragraphIdsInDocumentOrder } from './tree-op-blocks.ts';
import { removalEndsStoryWithTable } from '../package/ooxml-story-end-repair.ts';
import {
  cloneWithNewIds,
  declaredLockOf,
  effectiveLockOf,
  fromEdit,
  namedChild,
  paragraphPropertiesNodeOf,
  parentOf,
  TEXT_DEPS,
} from './tree-op-nodes.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';
import { tocRestriction } from './tree-op-toc.ts';
import type { TreeDocOp, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

export type RemoveTocOp = Extract<TreeDocOp, { op: 'removeToc' }>;

interface RemovalPlan {
  /** Blocks removed whole: paragraphs of the field, or the control. */
  readonly removed: readonly string[];
  /** A block rewritten in place: the paragraph that keeps the text around the field. */
  readonly survivor?: { readonly replaces: string; readonly node: OoxmlElement };
  /** Every paragraph that leaves the tree. */
  readonly deleted: readonly string[];
  /** Where the cut was, in the survivor. */
  readonly caretOffset: number;
}

/** Range marker elements, by the family whose start and end share a `w:id`. */
const RANGE_MARKERS: ReadonlyMap<string, string> = new Map([
  ['bookmarkStart', 'bookmark'],
  ['bookmarkEnd', 'bookmark'],
  ['commentRangeStart', 'comment'],
  ['commentRangeEnd', 'comment'],
  ['permStart', 'perm'],
  ['permEnd', 'perm'],
  ['moveFromRangeStart', 'moveFrom'],
  ['moveFromRangeEnd', 'moveFrom'],
  ['moveToRangeStart', 'moveTo'],
  ['moveToRangeEnd', 'moveTo'],
]);
/** Elements that take no space and say nothing on their own once a removal cuts around them. */
const isZeroWidth = (node: OoxmlNode): boolean =>
  node.kind !== 'textValue' &&
  (RANGE_MARKERS.has(node.localName) ||
    node.localName === 'proofErr' ||
    node.localName === 'lastRenderedPageBreak');

const withChildren = (node: OoxmlElement, children: readonly OoxmlNode[]): OoxmlElement =>
  ({ ...node, children }) as OoxmlElement;

const isNamed = (node: OoxmlNode, name: string): boolean =>
  node.kind !== 'textValue' && node.localName === name;

const isProperties = (node: OoxmlNode): boolean =>
  node.kind !== 'textValue' && node.localName.endsWith('Pr');

/**
 * Whether a paragraph holds text or objects, not only its properties and zero-width marks. A
 * run that holds only a rendered page break, as the run of a field at a page top does, is empty.
 */
function holdsContent(paragraph: OoxmlElement): boolean {
  const empty = (node: OoxmlNode): boolean =>
    isProperties(node) ||
    isZeroWidth(node) ||
    (node.kind === 'run' &&
      node.children.every((child) => isProperties(child) || isZeroWidth(child)));
  return !paragraph.children.every(empty);
}

/** Every range marker under a node, in document order. */
function markersIn(node: OoxmlNode, out: OoxmlElement[] = []): OoxmlElement[] {
  if (node.kind === 'textValue') return out;
  if (RANGE_MARKERS.has(node.localName)) out.push(node);
  for (const child of node.children) markersIn(child, out);
  return out;
}

function pairKey(marker: OoxmlElement): string {
  const id = marker.attributes.find((attribute) => attribute.localName === 'id')?.value ?? '';
  return `${RANGE_MARKERS.get(marker.localName)}:${id}`;
}

/**
 * Comment reference runs under `nodes` for the comments whose range end is carried: the
 * reference anchors the comment, so it moves to the cut with the end of its range.
 */
function carriedReferences(
  nodes: readonly OoxmlNode[],
  carried: readonly OoxmlElement[],
  kept: ReadonlySet<string>
): OoxmlNode[] {
  const ends = new Set(
    carried.filter((m) => m.localName === 'commentRangeEnd').map((m) => pairKey(m))
  );
  if (ends.size === 0) return [];
  const runs: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue' || kept.has(node.id)) return;
    if (node.kind === 'run') {
      const reference = node.children.find((child) => isNamed(child, 'commentReference'));
      const id = reference?.attributes.find((attribute) => attribute.localName === 'id')?.value;
      if (reference && id !== undefined && ends.has(`comment:${id}`)) {
        runs.push(
          withChildren(
            node,
            node.children.filter((c) => isProperties(c) || c === reference)
          )
        );
        return;
      }
    }
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  return runs;
}

/** Removed markers whose partner survives; a pair removed whole is dropped. */
function carriedMarkers(removed: readonly OoxmlElement[]): OoxmlElement[] {
  const count = new Map<string, number>();
  for (const marker of removed) count.set(pairKey(marker), (count.get(pairKey(marker)) ?? 0) + 1);
  return removed.filter((marker) => count.get(pairKey(marker)) === 1);
}

/**
 * The paragraph without the field: the content before the begin marker in the begin paragraph,
 * and after the end marker in the end paragraph. A paragraph between them keeps nothing.
 */
function outsideField(
  paragraph: OoxmlElement,
  toc: DetectedToc,
  endNodeId: string,
  side: 'before' | 'after' | 'both' = 'both'
): OoxmlElement {
  let active = paragraph.id === toc.beginParagraphId && side !== 'after';
  const walk = (node: OoxmlNode, depth: number): OoxmlNode | null => {
    if (node.id === toc.beginNodeId) {
      active = false;
      return null;
    }
    if (node.id === endNodeId) {
      active = side !== 'before';
      return null;
    }
    if (node.kind === 'textValue') return active ? node : null;
    if (isProperties(node)) return node;
    if (depth >= MAX_INLINE_CONTAINER_DEPTH || node.children.length === 0) {
      return active ? node : null;
    }
    const childDepth = nextInlineContainerDepth(node, depth);
    const children = node.children.flatMap((child) => {
      const kept = walk(child, childDepth);
      return kept ? [kept] : [];
    });
    if (children.every(isProperties)) return null;
    return children.length === node.children.length &&
      children.every((child, index) => child === node.children[index])
      ? node
      : ({ ...node, children } as OoxmlNode);
  };
  const children = paragraph.children.flatMap((child) => {
    const kept = walk(child, 0);
    return kept ? [kept] : [];
  });
  return { ...paragraph, children } as OoxmlElement;
}

const carriesSectionMark = (paragraph: OoxmlElement): boolean =>
  namedChild(paragraphPropertiesNodeOf(paragraph), 'sectPr') !== undefined;

function holdsControl(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  return node.children.some(
    (child) => (child.kind !== 'textValue' && child.localName === 'sdt') || holdsControl(child)
  );
}

function galleryOf(control: OoxmlElement): string | undefined {
  const properties = namedChild(control, 'sdtPr');
  const gallery = namedChild(namedChild(properties, 'docPartObj'), 'docPartGallery');
  return gallery?.attributes.find((attribute) => attribute.localName === 'val')?.value;
}

/** Paragraphs of a block, in order: the control's paragraphs or the paragraph itself. */
function paragraphsIn(node: OoxmlNode): OoxmlElement[] {
  if (node.kind === 'textValue') return [];
  if (node.kind === 'paragraph') return [node];
  return node.children.flatMap(paragraphsIn);
}

/**
 * The table of contents gallery control, when removing it takes nothing but this table of
 * contents and its heading: the control names this table of contents, the field starts and
 * ends at paragraph edges, no block follows the field, and the heading paragraphs before it
 * hold no field and no control. A control locked against deletion stays.
 */
function wholeControl(part: OoxmlPart, toc: DetectedToc, endNodeId: string): OoxmlElement | null {
  if (!toc.contentControlId || toc.id !== toc.contentControlId) return null;
  const control = findNode(part, toc.contentControlId);
  const content = findNode(part, toc.containerId);
  if (!control || control.kind === 'textValue' || !content || content.kind === 'textValue') {
    return null;
  }
  if (parentOf(part, content.id)?.id !== control.id) return null;
  if (galleryOf(control) !== 'Table of Contents') return null;
  if (effectiveLockOf(part, control).wrapper) return null;
  const blocks = content.children.filter((block) => !isProperties(block) && !isZeroWidth(block));
  const first = blocks.findIndex((block) => block.id === toc.beginParagraphId);
  if (first < 0 || blocks.at(-1)?.id !== toc.endParagraphId) return null;
  for (const block of blocks.slice(0, first)) {
    if (block.kind !== 'paragraph' || holdsFieldBoundary(block) || holdsControl(block)) {
      return null;
    }
  }
  // A table or a control inside the field is content the field path refuses to remove unseen.
  if (blocks.slice(first).some((block) => block.kind !== 'paragraph')) return null;
  const begin = blocks[first] as OoxmlElement;
  const end = blocks.at(-1) as OoxmlElement;
  if (holdsContent(outsideField(begin, toc, endNodeId))) return null;
  if (holdsContent(outsideField(end, toc, endNodeId))) return null;
  return control;
}

function planWholeControl(part: OoxmlPart, control: OoxmlElement): RemovalPlan | TreeOpRejection {
  const paragraphs = paragraphsIn(control);
  // A section break before the last paragraph would move the content after it into the
  // section before, so it refuses; one on the last paragraph stays.
  if (paragraphs.slice(0, -1).some(carriesSectionMark)) return 'carries-section-mark';
  const marked = paragraphs.slice(-1).filter(carriesSectionMark);
  if (lockedControlIn(control.children)) return 'locked';
  const markers = carriedMarkers(markersIn(control));
  const carried = [...markers, ...carriedReferences(control.children, markers, new Set())];
  const deleted = new Set(paragraphs.map((paragraph) => paragraph.id));
  // The container keeps a block for the caret: a body, a cell, or an outer control.
  const parent = parentOf(part, control.id);
  const siblings = (parent?.children ?? []).filter(
    (child) => child.id !== control.id && !isProperties(child) && !isZeroWidth(child)
  );
  // A story that ends with a paragraph keeps one after a final table, as a deletion does.
  const endsAfterTable = removalEndsStoryWithTable(control.id, (id) => parentOf(part, id));
  if (carried.length === 0 && marked.length === 0 && siblings.length > 0 && !endsAfterTable) {
    return { removed: [control.id], deleted: [...deleted], caretOffset: 0 };
  }
  // One empty paragraph stays in place of the control: the one with the section mark, which
  // keeps its properties, or a plain one for the caret and the carried markers.
  const kept = marked[0] ?? paragraphs.at(-1)!;
  deleted.delete(kept.id);
  const properties = marked[0] ? kept.children.filter(isProperties) : [];
  return {
    removed: [],
    survivor: { replaces: control.id, node: withChildren(kept, [...properties, ...carried]) },
    deleted: [...deleted],
    caretOffset: 0,
  };
}

/** Whether a node list holds a content control, not in `kept`, locked against change. */
function lockedControlIn(
  nodes: readonly OoxmlNode[],
  kept: ReadonlySet<string> = new Set()
): boolean {
  return nodes.some((node) => {
    if (node.kind === 'textValue' || kept.has(node.id)) return false;
    if (node.localName === 'sdt') {
      const lock = declaredLockOf(node);
      if (lock.wrapper || lock.content) return true;
    }
    return lockedControlIn(node.children, kept);
  });
}

function planRemoval(part: OoxmlPart, toc: DetectedToc): RemovalPlan | TreeOpRejection {
  const range = tocFieldRange(toc);
  const container = findNode(part, toc.containerId);
  if (!range || !container || container.kind === 'textValue') return 'unknown-block';

  const control = wholeControl(part, toc, range.endNodeId);
  if (control) return planWholeControl(part, control);

  const first = container.children.findIndex((child) => child.id === toc.beginParagraphId);
  const last = container.children.findIndex((child) => child.id === toc.endParagraphId);
  if (first < 0 || last < first) return 'unknown-block';
  const blocks = container.children.slice(first, last + 1);
  // A table or a control inside the field is content this op would remove unseen. A range
  // marker between the rows goes with them, to the cut when its partner stays.
  const between = blocks.filter((block) => block.kind !== 'paragraph');
  if (!between.every(isZeroWidth)) return 'not-a-block';
  const paragraphs = blocks.filter((block) => block.kind === 'paragraph') as OoxmlElement[];
  // A section break before the end paragraph would move the content after it into the
  // section before, so it refuses; one on the end paragraph stays.
  if (paragraphs.slice(0, -1).some(carriesSectionMark)) return 'carries-section-mark';
  const begin = paragraphs[0]!;
  const end = paragraphs.at(-1)!;
  const before = outsideField(begin, toc, range.endNodeId, 'before');
  const original = outsideField(end, toc, range.endNodeId, 'after');
  const after = sharedIdsCloned(before, original, part);
  const keepBefore = holdsContent(before);
  const keepAfter = holdsContent(after);
  // The begin paragraph survives when text comes before the field (or after it, when the
  // field begins and ends in it), else the end paragraph when text comes after the field.
  const inBegin = keepBefore || (begin === end && keepAfter);
  const head = inBegin ? before.children : [];
  const tail = inBegin && keepAfter ? after.children.filter((c) => !isProperties(c)) : [];

  // Markers of everything removed whose partner stays go to the cut. The kept text is read
  // before `sharedIdsCloned` gives the tail new ids, so its markers count as kept.
  const keptAfter = original.children.filter((c) => !isProperties(c));
  const keptSlice = inBegin
    ? [...head, ...(keepAfter ? keptAfter : [])]
    : keepAfter
      ? original.children
      : [];
  const kept = new Set(markersIn(withChildren(begin, keptSlice)).map((marker) => marker.id));
  const keptNodes = new Set<string>();
  const collect = (node: OoxmlNode): void => {
    keptNodes.add(node.id);
    if (node.kind !== 'textValue') node.children.forEach(collect);
  };
  keptSlice.forEach(collect);
  // Only removed content can refuse: a locked control in the text that stays does not.
  if (lockedControlIn(blocks, keptNodes)) return 'locked';
  const markers = carriedMarkers(
    blocks.flatMap((block) => markersIn(block)).filter((m) => !kept.has(m.id))
  );
  const carried = [...markers, ...carriedReferences(blocks, markers, keptNodes)];
  const rest = container.children.filter(
    (child) => child.kind === 'paragraph' && !paragraphs.includes(child as OoxmlElement)
  );

  let survivor: OoxmlElement | undefined;
  let caretOffset = 0;
  if (inBegin) {
    // The joined paragraph keeps the begin paragraph's properties and the end paragraph's
    // section mark, as a join does.
    const endMark =
      begin === end ? undefined : namedChild(paragraphPropertiesNodeOf(end), 'sectPr');
    const properties = endMark
      ? withSectionMark(head.filter(isProperties), endMark, createNodeIdAllocator(part))
      : head.filter(isProperties);
    const content = head.filter((child) => !isProperties(child));
    survivor = withChildren(begin, [...properties, ...content, ...carried, ...tail]);
    const cut = withChildren(begin, [...properties, ...content]);
    caretOffset = paragraphOffsetIndex(cut as OoxmlParagraphNode).length;
  } else if (keepAfter) {
    const properties = after.children.filter(isProperties);
    const content = after.children.filter((child) => !isProperties(child));
    survivor = withChildren(end, [...properties, ...carried, ...content]);
  } else if (
    rest.length === 0 ||
    carriesSectionMark(end) ||
    carried.length > 0 ||
    removalEndsStoryWithTable(
      [...paragraphs, ...between].map((block) => block.id),
      (id) => parentOf(part, id)
    )
  ) {
    // A cell or a document needs one paragraph; a section mark and carried markers need one,
    // and so does a story the removal would leave ending with a table.
    survivor = withChildren(end, [...end.children.filter(isProperties), ...carried]);
  }
  const removed = paragraphs.filter((paragraph) => paragraph.id !== survivor?.id);
  const ids = [...removed.map((paragraph) => paragraph.id), ...between.map((block) => block.id)];
  return {
    removed: ids,
    ...(survivor ? { survivor: { replaces: survivor.id, node: survivor } } : {}),
    deleted: removed.map((paragraph) => paragraph.id),
    caretOffset,
  };
}

/**
 * The text after a field that begins and ends in one paragraph, with fresh ids for any node
 * the text before it also holds: an inline wrapper around the whole field is cut in two.
 */
function sharedIdsCloned(before: OoxmlElement, after: OoxmlElement, part: OoxmlPart): OoxmlElement {
  if (before.id !== after.id) return after;
  const ids = new Set<string>();
  const collect = (node: OoxmlNode): void => {
    ids.add(node.id);
    if (node.kind !== 'textValue') node.children.forEach(collect);
  };
  before.children.filter((child) => !isProperties(child)).forEach(collect);
  const content = after.children.filter((child) => !isProperties(child));
  const shared = (node: OoxmlNode): boolean =>
    ids.has(node.id) || (node.kind !== 'textValue' && node.children.some(shared));
  if (!content.some(shared)) return after;
  const mint = createNodeIdAllocator(part);
  return withChildren(after, [
    ...after.children.filter(isProperties),
    ...content.map((child) => (shared(child) ? cloneWithNewIds(child, mint) : child)),
  ]);
}

/** Paragraph properties with `mark` as their section mark, in schema order. */
function withSectionMark(
  properties: readonly OoxmlNode[],
  mark: OoxmlElement,
  mint: () => string
): OoxmlNode[] {
  const pPr = properties.find((node) => node.kind !== 'textValue' && node.localName === 'pPr');
  if (!pPr || pPr.kind === 'textValue') {
    const fresh = {
      id: mint(),
      kind: 'paragraphProperties',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'pPr',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [mark],
    } as unknown as OoxmlNode;
    // `w:pPr` is the paragraph's first child.
    return [fresh, ...properties];
  }
  const change = pPr.children.findIndex(
    (child) => child.kind !== 'textValue' && child.localName === 'pPrChange'
  );
  const at = change < 0 ? pPr.children.length : change;
  const children = [...pPr.children.slice(0, at), mark, ...pPr.children.slice(at)];
  return properties.map((node) => (node === pPr ? withChildren(pPr, children) : node));
}

export function validateRemoveToc(part: OoxmlPart, op: RemoveTocOp): TreeOpRejection | null {
  if (typeof op.tocId !== 'string' || op.tocId.length === 0) return 'invalidArgs';
  const toc = findDetectedToc(detectBodyTocs(part), op.tocId);
  if (!toc) return 'unknown-block';
  const restriction = tocRestriction(part, toc);
  if (restriction) return restriction;
  const plan = planRemoval(part, toc);
  return typeof plan === 'string' ? plan : null;
}

export function applyRemoveToc(
  part: OoxmlPart,
  op: RemoveTocOp,
  options?: EditOptions
): TreeOpResult {
  const toc = findDetectedToc(detectBodyTocs(part), op.tocId);
  if (!toc) return { ok: false, reason: 'unknown-block' };
  const plan = planRemoval(part, toc);
  if (typeof plan === 'string') return { ok: false, reason: plan };
  // The caret goes to the cut in the survivor, else to the start of the paragraph after the
  // table of contents, as after a deletion, else to the end of the one before it.
  const gone = new Set(plan.deleted);
  const order = paragraphIdsInDocumentOrder(part);
  const firstGone = order.findIndex((id) => gone.has(id));
  const next = order.slice(firstGone + 1).find((id) => !gone.has(id));
  const previous = order
    .slice(0, Math.max(firstGone, 0))
    .reverse()
    .find((id) => !gone.has(id));
  const caret = plan.survivor?.node.id ?? next ?? previous;
  if (!caret) return { ok: false, reason: 'block-required' };
  const previousNode = !plan.survivor && !next && previous ? findNode(part, previous) : null;
  const offset = plan.survivor
    ? plan.caretOffset
    : previousNode?.kind === 'paragraph'
      ? paragraphOffsetIndex(previousNode).length
      : 0;
  const survivor = plan.survivor;
  const step: EditOptions = { ...options, deferValidation: true };
  const edits = [
    ...(survivor
      ? [(current: OoxmlPart) => replaceNode(current, survivor.replaces, survivor.node, step)]
      : []),
    ...plan.removed.map((id) => (current: OoxmlPart) => removeNode(current, id, step)),
  ];
  return fromEdit(applyEdits(part, edits, options), {
    dirty: survivor ? [survivor.node.id] : [],
    created: [],
    deleted: plan.deleted,
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
    caret: { paragraphId: caret, offset },
  });
}
