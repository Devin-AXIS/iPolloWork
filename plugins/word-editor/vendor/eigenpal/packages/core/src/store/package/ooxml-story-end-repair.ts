/**
 * The paragraph a story ends with when its file ends it with a table.
 *
 * A document body, a footnote or endnote, and a text box always end with a paragraph. A file
 * that ends one with a table reads as if an empty paragraph followed the table: it takes a
 * line below the table, can open a page of its own, holds the caret, and is saved. A table at
 * the end of a block-level content control or custom XML element ends the story too; the
 * paragraph then follows the wrapper.
 *
 * Headers and footers keep their content as written: a table may end them, and nothing below
 * it takes a line. A table cell is not repaired either, since such a file is not opened at all.
 */
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

/**
 * Wrapper nesting a story walk follows: `MAX_CONTENT_CONTROL_NESTING`, as deep as content
 * controls are read. The tree read runs this module, so it cannot import that one.
 */
const MAX_WRAPPER_DEPTH = 32;

/** The id suffix of the paragraph the read adds after a final table. */
const STORY_END_SUFFIX = '~end';

/** Whether `node` is the WML element `localName`. */
export const isWmlNamed = (node: OoxmlNode, localName: string): node is OoxmlElement =>
  node.kind !== 'textValue' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  node.localName === localName;

/** Stories that end with a paragraph: a body, a footnote or endnote, and a text box. */
const STORY_NAMES: ReadonlySet<string> = new Set(['body', 'footnote', 'endnote', 'txbxContent']);

/** Elements a story block can sit in without leaving the story's own block sequence. */
const WRAPPER_NAMES: ReadonlySet<string> = new Set(['sdt', 'sdtContent', 'customXml']);

/** Markers that close a range: one after the final table ends the range there. */
const RANGE_ENDS: ReadonlySet<string> = new Set([
  'bookmarkEnd',
  'commentRangeEnd',
  'permEnd',
  'moveFromRangeEnd',
  'moveToRangeEnd',
  'customXmlInsRangeEnd',
  'customXmlDelRangeEnd',
  'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeEnd',
]);

/** A range end after the table, or the whitespace between such markers. */
const closesOnTable = (node: OoxmlNode): boolean =>
  node.kind === 'textValue'
    ? node.value.trim() === ''
    : node.namespaceUri === WML_NAMESPACE_URI && RANGE_ENDS.has(node.localName);

/** Node ids a removal takes away. */
type Removed = ReadonlySet<string>;
const NONE: Removed = new Set();

const isWrapper = (node: OoxmlNode): node is OoxmlElement =>
  isWmlNamed(node, 'sdt') || isWmlNamed(node, 'customXml');

/** The blocks of a block wrapper: a control's content, or a custom XML element's children. */
function wrappedBlocks(wrapper: OoxmlElement): readonly OoxmlNode[] {
  if (wrapper.localName === 'customXml') return wrapper.children;
  for (const child of wrapper.children) if (isWmlNamed(child, 'sdtContent')) return child.children;
  return [];
}

/** Whether `node` is or holds a story block that is not removed. An empty wrapper holds none. */
function holdsBlock(node: OoxmlNode, depth: number, removed: Removed): boolean {
  if (node.kind === 'textValue' || removed.has(node.id)) return false;
  if (isWmlNamed(node, 'p') || isWmlNamed(node, 'tbl') || isWmlNamed(node, 'altChunk')) return true;
  if (!isWrapper(node) || depth >= MAX_WRAPPER_DEPTH) return false;
  return wrappedBlocks(node).some((child) => holdsBlock(child, depth + 1, removed));
}

/** Whether `node` is or holds a story block, so it can end a story. */
export const holdsStoryBlock = (node: OoxmlNode): boolean => holdsBlock(node, 0, NONE);

/** The index of the last block of `children` that is not removed, or -1. */
function lastBlockIndex(children: readonly OoxmlNode[], depth: number, removed: Removed): number {
  for (let index = children.length - 1; index >= 0; index -= 1) {
    if (holdsBlock(children[index]!, depth, removed)) return index;
  }
  return -1;
}

/** Whether the block `node` is, or ends with, a table, through block wrappers. */
function blockEndsWithTable(node: OoxmlNode | undefined, depth: number, removed: Removed): boolean {
  if (!node || node.kind === 'textValue') return false;
  if (isWmlNamed(node, 'tbl')) return true;
  if (!isWrapper(node)) return false;
  const blocks = wrappedBlocks(node);
  return blockEndsWithTable(blocks[lastBlockIndex(blocks, depth + 1, removed)], depth + 1, removed);
}

/**
 * Whether the story blocks `children` end with a table, through block wrappers. With
 * `removed`, the answer is for the same blocks once the nodes with those ids are gone.
 */
export function storyEndsWithTable(
  children: readonly OoxmlNode[],
  removed: Removed = NONE
): boolean {
  return blockEndsWithTable(children[lastBlockIndex(children, 0, removed)], 0, removed);
}

/** Whether the element `name` is a story that must end with a paragraph. */
export function storyEndsWithParagraph(name: {
  readonly namespaceUri: string;
  readonly localName: string;
}): boolean {
  return name.namespaceUri === WML_NAMESPACE_URI && STORY_NAMES.has(name.localName);
}

/**
 * Whether removing the nodes `nodeIds` leaves a story that ends with a paragraph ending with
 * a table instead. The nodes share the story of the first one, possibly in block wrappers at
 * its end. A story that already ends with a table, for example after a merge from another
 * participant, is not refused, so editing it can go on.
 */
export function removalEndsStoryWithTable(
  nodeIds: string | readonly string[],
  parentOf: (id: string) => OoxmlElement | null
): boolean {
  const removed: Removed = new Set(typeof nodeIds === 'string' ? [nodeIds] : nodeIds);
  const [first] = removed;
  let parent = first === undefined ? null : parentOf(first);
  for (let step = 0; parent && step <= 2 * MAX_WRAPPER_DEPTH; step += 1) {
    if (storyEndsWithParagraph(parent)) {
      return !storyEndsWithTable(parent.children) && storyEndsWithTable(parent.children, removed);
    }
    if (parent.namespaceUri !== WML_NAMESPACE_URI || !WRAPPER_NAMES.has(parent.localName)) {
      return false;
    }
    parent = parentOf(parent.id);
  }
  return false;
}

/**
 * `children` of a story, with an empty paragraph right after the block that ends it when
 * that block is, or ends with, a table. The same children when nothing is missing. An edit
 * passes the new paragraph's `id`; a read derives it from the block before.
 */
export function withStoryEndParagraph(
  children: readonly OoxmlNode[],
  id?: () => string
): readonly OoxmlNode[] {
  const index = lastBlockIndex(children, 0, NONE);
  const last = children[index];
  if (!last || last.kind === 'textValue' || !blockEndsWithTable(last, 0, NONE)) return children;
  const paragraph = {
    id: id ? id() : `${last.id}${STORY_END_SUFFIX}`,
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    ...(last.prefix === undefined ? {} : { prefix: last.prefix }),
    // The block's own declaration of its prefix, when it has one, travels with the prefix.
    namespaceBindings: last.namespaceBindings.filter(
      (binding) => binding.prefix === (last.prefix ?? '')
    ),
    attributes: [],
    children: [],
  } as OoxmlNode;
  // After the range ends that close on the table, so no range grows to cover the paragraph.
  let at = index + 1;
  while (at < children.length && closesOnTable(children[at]!)) at += 1;
  return [...children.slice(0, at), paragraph, ...children.slice(at)];
}

/**
 * `pkg` without the paragraph its read added after a table that ends the main body. A
 * clipboard fragment is a run of blocks, not a story: a table copied alone pastes alone.
 */
export function withoutStoryEndParagraph(pkg: OoxmlPackage): OoxmlPackage {
  const part = pkg.parts.get(pkg.mainDocumentPart);
  if (!part) return pkg;
  for (const body of part.root.children) {
    if (!isWmlNamed(body, 'body')) continue;
    const index = lastBlockIndex(body.children, 0, NONE);
    const last = body.children[index];
    if (!last || last.kind !== 'paragraph' || !last.id.endsWith(STORY_END_SUFFIX)) return pkg;
    const children = body.children.filter((_, at) => at !== index);
    const root = {
      ...part.root,
      children: part.root.children.map((child) => (child === body ? { ...body, children } : child)),
    } as OoxmlElement;
    const parts = new Map(pkg.parts);
    parts.set(pkg.mainDocumentPart, { ...part, root });
    return { ...pkg, parts };
  }
  return pkg;
}
