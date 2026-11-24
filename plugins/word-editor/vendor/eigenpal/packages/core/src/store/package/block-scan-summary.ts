// One walk of a paragraph or table row for the save passes that each read the whole tree.
//
// A save makes revision ids unique, and then keeps text box fallbacks in step. Both walk every
// block of every part. Most blocks hold neither a revision nor a text box wrapper, and both
// passes only need to know that. One walk of each block answers both, and the tree is
// immutable, so a later save reuses the answer for every block an edit did not replace.

import { isMcAlternateContent } from './drawing-projection-walk.ts';
import { MC_NAMESPACE_URI, WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import { REVISION_ID_BEARING } from '../store/tree-op-revision-ids.ts';

/** The range families whose start and end share one revision id. */
export const PAIRED_RANGE_FAMILIES = [
  'moveFrom',
  'moveTo',
  'customXmlIns',
  'customXmlDel',
  'customXmlMoveFrom',
  'customXmlMoveTo',
] as const;

/** WML elements whose `w:id` is a revision id. */
const REVISION_ID_ELEMENTS: ReadonlySet<string> = new Set([
  ...REVISION_ID_BEARING,
  ...PAIRED_RANGE_FAMILIES.flatMap((family) => [`${family}RangeStart`, `${family}RangeEnd`]),
]);

/** What one walk of a block found. */
export interface BlockScanSummary {
  /** Nodes in the block, the block itself and text values included. */
  readonly size: number;
  /** Whether the block holds an `mc:AlternateContent`. */
  readonly alternateContent: boolean;
  /** Whether the block holds an element that can carry a revision id. */
  readonly revisionIds: boolean;
  /** `w:txbxContent` stories in the block, outside any `mc:Fallback`. */
  readonly textBoxes: number;
  /**
   * The revision id elements of the block in document order, when the block holds no text box
   * story and no `mc:Fallback`: then they are all of one story and all read. Otherwise null,
   * and the revision id pass walks the block itself.
   */
  readonly revisionElements: readonly OoxmlElement[] | null;
  /** The `w:id` value of each of `revisionElements`, in the same order. */
  readonly revisionValues: readonly (string | undefined)[] | null;
  /** Whether every one of `revisionElements` is a single revision element, not a range. */
  readonly singleOnly: boolean;
}

/** The value of an element's `w:id`, or undefined when it has none. */
function wmlIdOf(element: OoxmlElement): string | undefined {
  const attributes = element.attributes;
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (attribute.localName === 'id' && attribute.namespaceUri === WML_NAMESPACE_URI) {
      return attribute.value;
    }
  }
  return undefined;
}

const summaries = new WeakMap<OoxmlElement, BlockScanSummary>();

/** What a block walk counts inside one `mc:Fallback`: no text box there is a story. */
function fallbackScan(fallback: OoxmlElement): {
  size: number;
  revisionIds: boolean;
  alternateContent: boolean;
} {
  let size = 0;
  let revisionIds = false;
  let alternateContent = false;
  const nodes: OoxmlNode[] = [fallback];
  while (nodes.length > 0) {
    const node = nodes.pop()!;
    size += 1;
    if (node.kind === 'textValue') continue;
    if (node.namespaceUri === WML_NAMESPACE_URI && REVISION_ID_ELEMENTS.has(node.localName)) {
      revisionIds = true;
    }
    if (isMcAlternateContent(node)) alternateContent = true;
    for (const child of node.children) nodes.push(child);
  }
  return { size, revisionIds, alternateContent };
}

/** The summary of a paragraph or table row, from one walk per block identity. */
export function blockScanSummary(block: OoxmlElement): BlockScanSummary {
  const known = summaries.get(block);
  if (known !== undefined) return known;
  let size = 0;
  let alternateContent = false;
  let revisionIds = false;
  let textBoxes = 0;
  let nested = false;
  let singleOnly = true;
  const elements: OoxmlElement[] = [];
  const values: (string | undefined)[] = [];
  // Children go on the stack last first, so nodes leave it in document order.
  const nodes: OoxmlNode[] = [block];
  while (nodes.length > 0) {
    const node = nodes.pop()!;
    size += 1;
    if (node.kind === 'textValue') continue;
    if (node.namespaceUri === WML_NAMESPACE_URI) {
      if (REVISION_ID_ELEMENTS.has(node.localName)) {
        revisionIds = true;
        elements.push(node);
        values.push(wmlIdOf(node));
        if (singleOnly && !REVISION_ID_BEARING.has(node.localName)) singleOnly = false;
      } else if (node.localName === 'txbxContent') {
        nested = true;
        textBoxes += 1;
      }
    } else if (node.namespaceUri === MC_NAMESPACE_URI) {
      if (node.localName === 'Fallback') {
        // A fallback's copies are not stories of their own; see `RevisionIdScan.visit`. It is
        // rare, so it takes a walk of its own, and the main walk tracks no fallback state.
        nested = true;
        const inside = fallbackScan(node);
        size += inside.size - 1;
        if (inside.revisionIds) revisionIds = true;
        if (inside.alternateContent) alternateContent = true;
        continue;
      }
      if (!alternateContent && isMcAlternateContent(node)) alternateContent = true;
    }
    const children = node.children;
    for (let index = children.length - 1; index >= 0; index -= 1) nodes.push(children[index]!);
  }
  const summary = {
    size,
    alternateContent,
    revisionIds,
    textBoxes,
    revisionElements: nested ? null : elements,
    revisionValues: nested ? null : values,
    singleOnly,
  };
  summaries.set(block, summary);
  return summary;
}
