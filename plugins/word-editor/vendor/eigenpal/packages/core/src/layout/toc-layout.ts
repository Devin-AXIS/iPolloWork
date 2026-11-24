// Layout-only helpers for cross-paragraph TOC complex fields.

import { fldCharType, isInstrTextNode } from '../store/package/field-nodes.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { detectBodyTocs, type DetectedToc } from '../store/package/toc-detect.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
} from '../store/package/ooxml-shared.ts';

const visibleTextByParagraph = new WeakMap<OoxmlElement, boolean>();

/** True when a paragraph carries visible `w:t` text outside field chrome. */
function paragraphHasVisibleText(paragraph: OoxmlElement): boolean {
  const cached = visibleTextByParagraph.get(paragraph);
  if (cached !== undefined) return cached;
  const result = computeParagraphHasVisibleText(paragraph);
  visibleTextByParagraph.set(paragraph, result);
  return result;
}

function computeParagraphHasVisibleText(paragraph: OoxmlElement): boolean {
  const walk = (node: OoxmlNode, depth: number): boolean => {
    if (node.kind === 'textValue') return false;
    if (depth >= MAX_INLINE_CONTAINER_DEPTH) return false;
    if (isInstrTextNode(node) || fldCharType(node) !== null) return false;
    if (node.kind === 'text' || node.localName === 't') {
      for (const child of node.children) {
        if (child.kind === 'textValue' && child.value.trim().length > 0) return true;
      }
      return false;
    }
    const nextDepth = nextInlineContainerDepth(node, depth);
    for (const child of node.children) {
      if (child.kind !== 'textValue' && walk(child, nextDepth)) return true;
    }
    return false;
  };
  for (const child of paragraph.children) {
    if (child.kind !== 'textValue' && walk(child, 0)) return true;
  }
  return false;
}

function tocHasVisibleResultContent(part: OoxmlPart, toc: DetectedToc): boolean {
  for (const paragraphId of toc.resultParagraphIds) {
    const node = findNode(part, paragraphId);
    if (!node || node.kind === 'textValue' || node.kind !== 'paragraph') continue;
    if (paragraphHasVisibleText(node)) return true;
  }
  return false;
}

// Parts are immutable (edits publish a new part object), so each of these id sets is a pure
// function of the part reference. Memoized because layout recomputes them on EVERY pass —
// including no-change passes — and `tocHasVisibleResultContent` walks result paragraphs.
const chromeIdsByPart = new WeakMap<OoxmlPart, ReadonlySet<string>>();
const placeholderIdsByPart = new WeakMap<OoxmlPart, ReadonlySet<string>>();
const suppressedIdsByPart = new WeakMap<OoxmlPart, ReadonlySet<string>>();

/** TOC boundary paragraphs whose empty instruction/chrome lines are suppressed. */
export function tocFieldChromeParagraphIds(part: OoxmlPart): ReadonlySet<string> {
  const cached = chromeIdsByPart.get(part);
  if (cached) return cached;
  const ids = new Set<string>();
  for (const toc of detectBodyTocs(part)) {
    // Word opens the field inside the FIRST ENTRY's paragraph: begin, the instruction and
    // the separator are followed by that entry's hyperlink in the same `w:p`. Suppressing
    // that paragraph deletes a real row, which shifted every cached entry upward and moved
    // the page break.
    //
    // So the question is not where the separator sits, it is whether this paragraph carries
    // any result of its own. One holding only field chrome contributes no row and is
    // suppressed; one holding an entry is that entry and is kept. `paragraphHasVisibleText`
    // already ignores `w:instrText` and `w:fldChar`, so it answers exactly that.
    const begin = findNode(part, toc.beginParagraphId);
    const beginCarriesResult =
      begin !== null &&
      begin.kind !== 'textValue' &&
      begin.kind === 'paragraph' &&
      paragraphHasVisibleText(begin);
    if (!beginCarriesResult) ids.add(toc.beginParagraphId);
    ids.add(toc.endParagraphId);
  }
  chromeIdsByPart.set(part, ids);
  return ids;
}

/**
 * Begin-paragraph ids of TOCs that have no visible cached result rows.
 *
 * Layout keeps a single caret-height line on these ids so paint can host an identifiable
 * empty-TOC furniture placeholder; ordinary field chrome on the same ids stays suppressed.
 */
export function emptyTocPlaceholderParagraphIds(part: OoxmlPart): ReadonlySet<string> {
  const cached = placeholderIdsByPart.get(part);
  if (cached) return cached;
  const ids = new Set<string>();
  for (const toc of detectBodyTocs(part)) {
    if (!tocHasVisibleResultContent(part, toc)) ids.add(toc.beginParagraphId);
  }
  placeholderIdsByPart.set(part, ids);
  return ids;
}

/**
 * Empty result-paragraph ids inside an empty TOC.
 *
 * Suppressed like field chrome so blank cached rows do not stack under the empty placeholder.
 */
export function emptyTocSuppressedResultParagraphIds(part: OoxmlPart): ReadonlySet<string> {
  const cached = suppressedIdsByPart.get(part);
  if (cached) return cached;
  const ids = new Set<string>();
  for (const toc of detectBodyTocs(part)) {
    if (tocHasVisibleResultContent(part, toc)) continue;
    for (const paragraphId of toc.resultParagraphIds) ids.add(paragraphId);
  }
  suppressedIdsByPart.set(part, ids);
  return ids;
}
