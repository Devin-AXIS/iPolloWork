// Story roots and the block walk inside one.
//
// ONE WALK, because "which paragraphs are in this story, in reading order" is a question two
// lanes ask and neither may answer differently. The paginated surface asks it to clamp a caret
// and to select all; the automation lane asks it to enumerate a story for an object model, to
// search it, and to place an insertion. Two walks would eventually disagree about a paragraph
// inside a nested table or inside a content control, and the symptom would be an offset landing
// in the wrong paragraph rather than anything that looks like a traversal bug.
//
// A STORY IS A ROOT, not a part: one part can hold many stories (a notes part holds a story per
// note), and a header part holds exactly one. Keeping the root and the walk separate is what
// lets a caller ask about one story without conflating it with its neighbours in the same part.
//
// Table cells, block-level content controls and block `w:customXml` are TRANSPARENT: a paragraph
// inside one is an ordinary editable paragraph, and reading order is the order you would meet
// them reading the page. Wrapper nesting is bounded, because the nesting depth is file-supplied
// and a document is untrusted input.

import {
  contentControlContentChildren,
  flattenContentControls,
  isContentControlWrapper,
} from './content-control-nodes.ts';
import type { OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { isInlineRunContainer, WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { isNormalNote } from './note-nodes.ts';

/** How deep transparent block wrappers may nest before the walk stops descending. */
export const MAX_STORY_SDT_NESTING = 32;

/** Children that join a story through one transparent block wrapper. */
export function blockStoryContainerChildren(node: OoxmlNode): readonly OoxmlNode[] | null {
  if (node.kind === 'textValue') return null;
  if (isContentControlWrapper(node)) return contentControlContentChildren(node);
  const children = node.children;
  if (
    node.kind === 'generic' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === 'customXml' &&
    !isInlineRunContainer(node)
  ) {
    return children;
  }
  return null;
}

/** Which kind of story a root is. Layout walks all four the same way. */
export type OoxmlStoryKind = 'body' | 'header' | 'footer' | 'note';

/** One story root and the blocks under it, with transparent block wrappers already flattened. */
export interface OoxmlStoryRoot {
  readonly kind: OoxmlStoryKind;
  /** The `w:body` / `w:hdr` / `w:ftr` / `w:footnote` element that holds the blocks. */
  readonly root: OoxmlNode;
}

function storyKindOf(node: OoxmlNode): OoxmlStoryKind | null {
  if (node.kind === 'textValue') return null;
  if (node.kind === 'body') return 'body';
  // A NORMAL note only. `w:separator` and `w:continuationSeparator` are the rules drawn above
  // a note area, not content: Word puts no caret in one, and layout paints them as a line
  // rather than as paragraphs. Counting them as stories made the tree claim two paragraphs the
  // layout never publishes, so anything ordering by layout ranked a caret in one at -1 — and a
  // selection ordered against -1 silently collapses to a single paragraph.
  //
  // Returning null lets the walk descend, and a separator holds no story root, so its
  // paragraph belongs to no story at all. That is the honest answer: it is not editable text.
  if (node.kind === 'note') return isNormalNote(node) ? 'note' : null;
  if (node.localName === 'hdr') return 'header';
  if (node.localName === 'ftr') return 'footer';
  return null;
}

/**
 * Every story root in a part, in document order.
 *
 * Does not descend INTO a story: a story's blocks are the walk below, and a story root never
 * contains another story root.
 */
export function storyRootsOf(part: OoxmlPart): readonly OoxmlStoryRoot[] {
  const roots: OoxmlStoryRoot[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    const kind = storyKindOf(node);
    if (kind) {
      roots.push({ kind, root: node });
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return roots;
}

/**
 * Whether a part is SHAPED to hold stories — a body, a header, a footer, or a notes part.
 *
 * A shape test, deliberately not `storyRootsOf(part).length > 0`. That counts EDITABLE stories,
 * and a notes part holding nothing but `w:separator` and `w:continuationSeparator` has none —
 * which is the footnotes part Word writes into every document that ever held a footnote. A
 * caller asking "should I walk this part at all" that used the editable count skipped it
 * entirely, and the two callers that ask are a payload sweep and an export strip: both DELETE
 * what they conclude nothing names.
 */
export function isStoryPart(part: OoxmlPart): boolean {
  const walk = (node: OoxmlNode): boolean => {
    if (node.kind === 'textValue') return false;
    // Any note, normal or furniture: the part is a notes part either way.
    if (node.kind === 'body' || node.kind === 'note') return true;
    if (node.localName === 'hdr' || node.localName === 'ftr') return true;
    for (const child of node.children) if (walk(child)) return true;
    return false;
  };
  return walk(part.root);
}

/** The main body story of a part, or null when the part holds none. */
export function bodyStoryRoot(part: OoxmlPart): OoxmlNode | null {
  for (const story of storyRootsOf(part)) {
    if (story.kind === 'body') return story.root;
  }
  return null;
}

/**
 * Every paragraph of one story, in reading order.
 *
 * Descends through tables (rows, cells, nested tables), block controls and block custom XML.
 * The returned nodes are paragraph elements; a caller addresses them by `id`.
 */
export function storyParagraphs(root: OoxmlNode): readonly OoxmlNode[] {
  if (root.kind === 'textValue') return [];
  const paragraphs: OoxmlNode[] = [];
  collectStoryParagraphs(root.children, paragraphs, 0);
  return paragraphs;
}

/**
 * The block walk itself, appending into `out`.
 *
 * Exported so `allParagraphs` in the binding lane is the same traversal rather than a second
 * copy of it.
 */
export function collectStoryParagraphs(
  children: readonly OoxmlNode[],
  out: OoxmlNode[],
  sdtDepth: number
): void {
  for (const child of children) {
    if (child.kind === 'paragraph') {
      out.push(child);
      continue;
    }
    if (child.kind === 'table') {
      // A controlled row or cell is still a row or a cell: `CT_SdtRow`/`CT_SdtCell` put the
      // wrapper where the filter looks, so unwrap before filtering or the story loses it.
      for (const row of flattenContentControls(child.children)) {
        if (row.kind !== 'tableRow') continue;
        for (const cell of flattenContentControls(row.children)) {
          if (cell.kind !== 'tableCell') continue;
          collectStoryParagraphs(cell.children, out, sdtDepth);
        }
      }
      continue;
    }
    const nested = blockStoryContainerChildren(child);
    if (nested !== null && sdtDepth < MAX_STORY_SDT_NESTING) {
      collectStoryParagraphs(nested, out, sdtDepth + 1);
    }
  }
}
