// Block removal: what `deleteBlock` may take out of the tree, and what it must refuse.
//
// A removal is the one edit that can leave a container the rest of the engine cannot read —
// a `w:tc` with no paragraph, a `w:tbl` with no row, a document with nowhere to put the
// caret. Every other op edits inside a block that stays. So the guards live here, run before
// any tree work, and the applier is nothing but the `removeNode` primitive plus an effect.
//
// Split out of tree-op-validate.ts because that module is at its size limit, and because the
// invariants a removal protects are a subject of their own rather than more of the offset
// and property checking that fills it.

import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { findNode, parentNodeOf } from '../package/ooxml-edit.ts';
import { flattenContentControls } from '../package/content-control-nodes.ts';
import { isWmlNamed, removalEndsStoryWithTable } from '../package/ooxml-story-end-repair.ts';
import { noteKindOf } from '../package/note-nodes.ts';
import { namedChild, paragraphPropertiesNodeOf } from './tree-op-nodes.ts';
import { planVerticalMergeHeadRepairs } from './tree-op-table-vmerge-removal.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';
import type { TreeOpRejection } from './tree-op-validate.ts';

/** The block kinds a removal may name — exactly the ones the canonical tree types. */
const REMOVABLE_BLOCK_KINDS: ReadonlySet<string> = new Set(['paragraph', 'table', 'tableRow']);

/** Every paragraph id inside a subtree, the target itself included when it is one. */
export function paragraphIdsWithin(node: OoxmlNode): string[] {
  const ids: string[] = [];
  const walk = (current: OoxmlNode): void => {
    if (current.kind === 'textValue') return;
    if (current.kind === 'paragraph') ids.push(current.id);
    for (const child of current.children) walk(child);
  };
  walk(node);
  return ids;
}

/** Nesting of block `w:customXml` wrappers a story walk follows, as deep as the read keeps them. */
const MAX_CUSTOM_XML_NESTING = 32;

/**
 * Story-order paragraph ids of one story's block sequence: tables, content controls, and block
 * custom XML elements included.
 */
function paragraphIdsInStoryOrder(story: OoxmlNode): string[] {
  const ids: string[] = [];
  const walkBlocks = (children: readonly OoxmlNode[], wrappers = 0): void => {
    // A block content control is not a block of its own — the paragraphs it wraps are the
    // story's, and the caret sits in them like any other. Without flattening, this walk and
    // the removal check would disagree about where the paragraphs are: the validator would
    // see one inside a `w:sdt` and allow the removal, then the applier would find no caret.
    for (const child of flattenContentControls(children)) {
      if (child.kind === 'paragraph') {
        ids.push(child.id);
      } else if (child.kind === 'table') {
        for (const row of child.children) {
          if (row.kind !== 'tableRow') continue;
          for (const cell of row.children) {
            if (cell.kind !== 'tableCell') continue;
            walkBlocks(cell.children);
          }
        }
      } else if (isWmlNamed(child, 'customXml') && wrappers < MAX_CUSTOM_XML_NESTING) {
        // A block custom XML element is transparent in the same way: its paragraphs are the
        // story's own, and a removal beside them must find them.
        walkBlocks(child.children, wrappers + 1);
      }
    }
  };
  if (story.kind !== 'textValue') walkBlocks(story.children);
  return ids;
}

/** Story-order paragraph ids of a part's main story: its body, or the root of a header or footer. */
export function paragraphIdsInDocumentOrder(part: OoxmlPart): string[] {
  const storyRoot =
    part.root.kind === 'body'
      ? part.root
      : (part.root.children.find((child) => child.kind === 'body') ?? part.root);
  return paragraphIdsInStoryOrder(storyRoot);
}

/**
 * Whether `node` holds a story of its own: a block sequence the caret stays inside, and one
 * that keeps at least one paragraph.
 *
 * A notes part holds one story per `w:footnote` or `w:endnote`, and a comments part one per
 * `w:comment`; a text box holds one in `w:txbxContent`. The part root is the story of a header
 * or footer, and the fallback for anything else.
 */
function isStoryContainer(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  if (node.kind === 'body' || node.kind === 'comment') return true;
  // Typed or generic `w:footnote` / `w:endnote`.
  if (noteKindOf(node) !== null) return true;
  return isWmlNamed(node, 'txbxContent') || isWmlNamed(node, 'comment');
}

/** The nearest story that holds `blockId`, or the part root when no ancestor is one. */
function storyContainerOf(part: OoxmlPart, blockId: string): OoxmlNode {
  for (let node = parentNodeOf(part, blockId); node; node = parentNodeOf(part, node.id)) {
    if (isStoryContainer(node)) return node;
  }
  return part.root;
}

/**
 * Where the caret goes once `blockId` is removed: the start of the first paragraph after the
 * block in story order, otherwise the end of the last paragraph before it.
 *
 * Either way the caret lands next to the removed block. The search stays inside the story that
 * holds the block: removing a paragraph from a footnote leaves the caret in that footnote, not
 * in the next note or in the document body. A story with no other paragraph has no surviving
 * caret at all, so validation and application refuse the removal together.
 */
export function caretAfterBlockRemoval(
  part: OoxmlPart,
  blockId: string
): { readonly paragraphId: string; readonly offset: number } | null {
  const block = findNode(part, blockId);
  if (!block) return null;
  const deleted = new Set(paragraphIdsWithin(block));
  const order = paragraphIdsInStoryOrder(storyContainerOf(part, blockId));
  const firstDeletedIndex = Math.max(
    order.findIndex((id) => deleted.has(id)),
    0
  );
  for (let i = firstDeletedIndex; i < order.length; i += 1) {
    const id = order[i]!;
    if (!deleted.has(id)) return { paragraphId: id, offset: 0 };
  }
  for (let i = firstDeletedIndex - 1; i >= 0; i -= 1) {
    const id = order[i]!;
    if (deleted.has(id)) continue;
    const before = findNode(part, id);
    const offset = before?.kind === 'paragraph' ? paragraphOffsetIndex(before).length : 0;
    return { paragraphId: id, offset };
  }
  return null;
}

/** How many children of a kind a container would keep once `blockId` leaves it. */
function remainingChildrenOfKind(parent: OoxmlNode, kind: string, blockId: string): number {
  if (parent.kind === 'textValue') return 0;
  return parent.children.filter((child) => child.kind === kind && child.id !== blockId).length;
}

export function validateDeleteBlock(part: OoxmlPart, blockId: string): TreeOpRejection | null {
  if (typeof blockId !== 'string' || blockId.length === 0) return 'unknown-block';
  const block = findNode(part, blockId);
  if (!block) return 'unknown-block';
  if (block.kind === 'textValue' || !REMOVABLE_BLOCK_KINDS.has(block.kind)) return 'not-a-block';

  const parent = parentNodeOf(part, blockId);
  // The root has no parent, so there is no child sequence to remove it from — and a part
  // without a root is not a part.
  if (!parent) return 'not-a-block';

  if (block.kind === 'paragraph') {
    // A `w:sectPr` in a paragraph's mark is not formatting: it is where a section ENDS
    // (17.6.17). `joinParagraphs` carries that mark onto the survivor; a removal has no
    // survivor to carry it to, and dropping it merges the section into the one that
    // follows — taking that section's page size, orientation and headers over every page.
    if (namedChild(paragraphPropertiesNodeOf(block), 'sectPr')) return 'carries-section-mark';
    // A cell must end with a paragraph (17.4.66); one with none is markup Word rejects and
    // a cell the caret can never enter.
    if (
      parent.kind === 'tableCell' &&
      remainingChildrenOfKind(parent, 'paragraph', blockId) === 0
    ) {
      return 'block-required';
    }
  }

  // A body, note or text box ends with a paragraph, as a cell does: the read adds one after a
  // final table (`ooxml-story-end-repair.ts`), and a removal must not take it away again.
  if (removalEndsStoryWithTable(blockId, (id) => parentNodeOf(part, id))) {
    return 'story-end-paragraph';
  }

  if (block.kind === 'tableRow' && remainingChildrenOfKind(parent, 'tableRow', blockId) === 0) {
    // A `w:tbl` with no `w:tr` has no content and no geometry. Removing the last row means
    // removing the table, which is a different op the caller has to ask for.
    return 'block-required';
  }
  if (block.kind === 'tableRow') {
    const repairs = planVerticalMergeHeadRepairs(part, blockId);
    if (!repairs.ok) return repairs.reason;
  }

  // A table nested in a cell is the cell's content; taking it out must still leave the
  // paragraph a cell has to end with. When other paragraphs survive in the document,
  // applyDeleteBlock inserts the required empty cell paragraph.
  if (
    block.kind === 'table' &&
    parent.kind === 'tableCell' &&
    remainingChildrenOfKind(parent, 'paragraph', blockId) === 0
  ) {
    if (!caretAfterBlockRemoval(part, blockId)) return 'block-required';
    return null;
  }

  // Whatever the kind: the story must keep somewhere to put the caret. A body, note, comment
  // or text box with no paragraph has no editable position at all, and every consumer that
  // clamps a selection to the story's first paragraph would have nothing to clamp to. The
  // check is the applier's own caret search, so the two cannot disagree.
  if (!caretAfterBlockRemoval(part, blockId)) return 'block-required';

  return null;
}
