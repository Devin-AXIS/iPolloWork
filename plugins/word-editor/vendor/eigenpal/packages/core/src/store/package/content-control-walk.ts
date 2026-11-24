// Shared content-control descent for tree walks.
//
// Block-level `w:sdt` / `contentControl` wrappers flatten transparently into the story
// (paragraphs and tables inside `sdtContent` / `contentControlContent` join the flow in
// reading order). Inline controls flatten the same way into a paragraph's run stream.
//
// During migration, `w:sdt` may still be `generic`; typed `contentControl` /
// `contentControlContent` nodes are the authority once the reader emits them. Both paths
// share one bound so nesting cannot recurse without limit.

import {
  isContentRevisionKind,
  isInlineRunContainer,
  MAX_INLINE_CONTAINER_DEPTH,
  WML_NAMESPACE_URI,
} from './ooxml-shared.ts';
import { blockStoryContainerChildren } from './story-blocks.ts';
import type {
  OoxmlContentControlContentNode,
  OoxmlContentControlNode,
  OoxmlElement,
  OoxmlGenericElementNode,
  OoxmlNode,
} from './ooxml-tree.ts';

/** Nested content-control wrappers deeper than this stop flattening; content stays preserved. */
export const MAX_CONTENT_CONTROL_NESTING = 32;

type ContentControlLike = OoxmlContentControlNode | OoxmlGenericElementNode;
type ContentControlContentLike = OoxmlContentControlContentNode | OoxmlGenericElementNode;

function nodeKind(node: OoxmlNode): string {
  return node.kind;
}

/**
 * Block or inline structured-document-tag wrapper — typed or generic during migration.
 *
 * Generic fallback requires the WordprocessingML namespace so foreign-namespace
 * `<x:sdt>` elements stay opaque wrappers and are never treated as Word controls.
 */
export function isContentControl(node: OoxmlNode): node is ContentControlLike {
  if (node.kind === 'textValue') return false;
  if (nodeKind(node) === 'contentControl') return true;
  return (
    node.kind === 'generic' && node.localName === 'sdt' && node.namespaceUri === WML_NAMESPACE_URI
  );
}

/**
 * True when `node` is the control's content container (`w:sdtContent`).
 *
 * Generic `sdtContent` requires the WML namespace — same foreign-namespace rule as
 * {@link isContentControl}.
 */
export function isContentControlContent(node: OoxmlNode): node is ContentControlContentLike {
  if (node.kind === 'textValue') return false;
  if (nodeKind(node) === 'contentControlContent') return true;
  return (
    node.kind === 'generic' &&
    node.localName === 'sdtContent' &&
    node.namespaceUri === WML_NAMESPACE_URI
  );
}

/** Children of the first `w:sdtContent` under a control, or null when absent or not a control. */
export function contentControlContentOf(node: OoxmlNode): readonly OoxmlNode[] | null {
  if (node.kind === 'textValue' || !isContentControl(node)) return null;
  for (const child of node.children) {
    if (child.kind === 'textValue') continue;
    if (isContentControlContent(child)) {
      return child.children;
    }
  }
  return null;
}

/**
 * Children of every `w:sdtContent` under a control, in document order.
 *
 * Does not recurse into nested controls. Block callers use
 * {@link MAX_CONTENT_CONTROL_NESTING}; paragraph callers use
 * {@link MAX_INLINE_CONTAINER_DEPTH} across all transparent containers.
 */
export function contentControlContentChildren(control: OoxmlNode): readonly OoxmlNode[] {
  if (control.kind === 'textValue' || !isContentControl(control)) return [];
  const out: OoxmlNode[] = [];
  for (const child of control.children) {
    if (child.kind === 'textValue') continue;
    if (isContentControlContent(child)) {
      for (const inner of child.children) out.push(inner);
    }
  }
  return out;
}

/**
 * Collect paragraph and table blocks from a sibling list, flattening through transparent block
 * wrappers up to {@link MAX_CONTENT_CONTROL_NESTING}.
 *
 * `accept` filters which typed blocks are kept (e.g. skip revision-removed paragraphs). When
 * nesting exceeds the bound the wrapper is skipped entirely — same fail-closed rule as the
 * historical `storyBlocks` walk.
 */
export function collectFlowBlocks(
  children: readonly OoxmlNode[],
  depth = 0,
  accept: (block: OoxmlElement) => boolean = () => true
): OoxmlElement[] {
  const blocks: OoxmlElement[] = [];
  const collect = (nodes: readonly OoxmlNode[], nest: number): void => {
    for (const child of nodes) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'paragraph' || child.kind === 'table') {
        if (accept(child)) blocks.push(child);
        continue;
      }
      const nested = blockStoryContainerChildren(child);
      if (nested !== null && nest < MAX_CONTENT_CONTROL_NESTING) {
        collect(nested, nest + 1);
      }
    }
  };
  collect(children, depth);
  return blocks;
}

/**
 * Story blocks in document order, flattening transparent block wrappers — same shape as layout's
 * `storyBlocks` and store `bodyBlocks`.
 */
export function walkStoryBlocks(
  children: readonly OoxmlNode[],
  depth: number,
  visit: (block: OoxmlElement) => void
): void {
  for (const child of children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'paragraph' || child.kind === 'table') {
      visit(child);
      continue;
    }
    const nested = blockStoryContainerChildren(child);
    if (nested !== null && depth < MAX_CONTENT_CONTROL_NESTING) {
      walkStoryBlocks(nested, depth + 1, visit);
    }
  }
}

/**
 * Every story paragraph in reading order — body, table cells, and flattened block controls.
 */
export function walkAllStoryParagraphs(
  children: readonly OoxmlNode[],
  sdtDepth: number,
  visit: (paragraph: OoxmlElement) => void
): void {
  for (const child of children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'paragraph') {
      visit(child);
    } else if (child.kind === 'table') {
      for (const row of child.children) {
        if (row.kind !== 'tableRow') continue;
        for (const cell of row.children) {
          if (cell.kind !== 'tableCell') continue;
          walkAllStoryParagraphs(cell.children, sdtDepth, visit);
        }
      }
    } else {
      const nested = blockStoryContainerChildren(child);
      if (nested !== null && sdtDepth < MAX_CONTENT_CONTROL_NESTING) {
        walkAllStoryParagraphs(nested, sdtDepth + 1, visit);
      }
    }
  }
}

/**
 * Paragraph-level inline sequence — runs and their bounded containers in document order.
 *
 * `visit` receives each direct `w:r` and any other inline node the caller treats as opaque
 * (bookmarks, drawings, …). Hyperlinks and controls are descended transparently. Callers
 * that address the runs inside tracked revisions can opt into descending those wrappers too.
 */
export function walkParagraphInline(
  children: readonly OoxmlNode[],
  depth: number,
  visit: (child: OoxmlNode) => void,
  options: { readonly descendRevisions?: boolean } = {}
): void {
  if (depth >= MAX_INLINE_CONTAINER_DEPTH) return;
  for (const child of children) {
    if (child.kind === 'textValue' || child.kind === 'paragraphProperties') continue;
    if (child.kind === 'run') {
      visit(child);
      continue;
    }
    // A revision wrapper is a run container like the rest, but descending it is OPT-IN: a
    // caller addressing runs inside tracked changes asks for it, and one that does not must
    // still meet the wrapper as an opaque node.
    if (isInlineRunContainer(child)) {
      if (isContentRevisionKind(child.kind) && options.descendRevisions !== true) {
        visit(child);
        continue;
      }
      walkParagraphInline(child.children, depth + 1, visit, options);
      continue;
    }
    if (isContentControl(child)) {
      const content = contentControlContentOf(child);
      if (content) walkParagraphInline(content, depth + 1, visit, options);
      continue;
    }
    visit(child);
  }
}
