// Bounded text collection for REF-family fields: the plain-REF bookmark range extractor,
// the `w:fldSimple` cached-display reader, and the small WML helpers they share. Split from
// `field-ref.ts`, which owns the grammar and the story context, so that module stays under
// its line budget. Every walk here is node/depth/character capped — the inputs are
// attacker-controlled OOXML.

import { visibleHyphenText } from '../store/package/hyphen-text.ts';
import {
  hardBreakKind,
  isFldSimple,
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import {
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
} from '../store/package/ooxml-shared.ts';
import {
  consumeScanNode,
  createScanBudget,
  MAX_STORY_FIELD_SCAN_DEPTH,
} from './field-instruction.ts';

/** Length cap on a plain REF's extracted text — file data must not inflate keys or spans. */
export const MAX_REF_TEXT_CHARS = 1024;

export function wmlAttribute(node: OoxmlElement, localName: string): string | undefined {
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName) {
      return attribute.value;
    }
  }
  return undefined;
}

/** A drawing hosts its own story; its bookmarks and fields are not this paragraph's. */
export function isDrawingHost(node: OoxmlElement): boolean {
  return node.kind === 'drawing' || node.localName === 'drawing' || node.localName === 'pict';
}

/** The `w:t` text of a `w:fldSimple`'s cached display, bounded and depth-capped. */
export function fldSimpleCachedText(
  simple: OoxmlElement,
  budget: ReturnType<typeof createScanBudget>
): string {
  let text = '';
  const visit = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || text.length >= MAX_REF_TEXT_CHARS) return;
    if (budget.exhausted || depth > MAX_STORY_FIELD_SCAN_DEPTH) return;
    if (!consumeScanNode(budget)) return;
    if (node.kind === 'text') {
      for (const value of node.children) {
        if (value.kind === 'textValue') {
          text += value.value.slice(0, MAX_REF_TEXT_CHARS - text.length);
        }
      }
      return;
    }
    // The same hyphen text the computed result carries, so a cache can match it.
    const hyphen = visibleHyphenText(node);
    if (hyphen !== null) {
      text += hyphen.slice(0, MAX_REF_TEXT_CHARS - text.length);
      return;
    }
    if (node.kind === 'revisionDelete') return;
    for (const child of node.children) visit(child, depth + 1);
  };
  for (const child of simple.children) visit(child, 1);
  return text;
}

/** Plain-REF text per (target paragraph, name), memoized on the immutable paragraph. */
const bookmarkTextMemos = new WeakMap<OoxmlElement, Map<string, string>>();

/**
 * The bookmarked text inside the target paragraph: from the named `w:bookmarkStart` to the
 * `w:bookmarkEnd` carrying the same `w:id`, or to the paragraph's end when the range runs
 * past it. Length-capped; collects `w:t`, tabs and line breaks only — deleted text, page
 * breaks, field chrome and drawings never join a computed result.
 */
export function bookmarkRangeText(paragraph: OoxmlElement, name: string): string {
  let memo = bookmarkTextMemos.get(paragraph);
  const cached = memo?.get(name);
  if (cached !== undefined) return cached;

  let collecting = false;
  let done = false;
  let endId: string | undefined;
  let text = '';
  const budget = createScanBudget();

  const append = (value: string): void => {
    const room = MAX_REF_TEXT_CHARS - text.length;
    if (room <= 0) {
      done = true;
      return;
    }
    text += value.length > room ? value.slice(0, room) : value;
  };

  const visit = (node: OoxmlNode, depth: number, containerDepth: number, deleted = false): void => {
    if (done || node.kind === 'textValue') return;
    if (containerDepth >= MAX_INLINE_CONTAINER_DEPTH) return;
    if (budget.exhausted || depth > MAX_STORY_FIELD_SCAN_DEPTH) return;
    if (node.kind === 'bookmarkStart') {
      if (!collecting && wmlAttribute(node, 'name') === name) {
        collecting = true;
        endId = wmlAttribute(node, 'id');
      }
      return;
    }
    if (node.kind === 'bookmarkEnd') {
      if (collecting && endId !== undefined && wmlAttribute(node, 'id') === endId) done = true;
      return;
    }
    if (node.kind === 'run') {
      // Deleted content never joins a computed result. A run holds no bookmark marker, so a
      // deleted one is skipped whole; markers beside it in the deletion still count.
      if (!collecting || deleted) return;
      for (const grand of node.children) {
        if (done || !consumeScanNode(budget)) return;
        if (grand.kind === 'text') {
          for (const value of grand.children) {
            if (value.kind === 'textValue') append(value.value);
          }
        } else if (grand.kind === 'tab') {
          append('\t');
        } else if (grand.kind === 'hardBreak' && hardBreakKind(grand) === 'line') {
          // A line break stays a line break in the result. A page break does not join it.
          append('\n');
        } else {
          // A REF result is read as one string, where an optional hyphen shows nothing.
          const hyphen = visibleHyphenText(grand);
          if (hyphen) append(hyphen);
        }
      }
      return;
    }
    if (isDrawingHost(node) || isFldSimple(node)) return;
    if (!consumeScanNode(budget)) return;
    const nextDepth = nextInlineContainerDepth(node, containerDepth);
    const within = deleted || node.kind === 'revisionDelete';
    for (const child of node.children) visit(child, depth + 1, nextDepth, within);
  };
  for (const child of paragraph.children) {
    if (done || !consumeScanNode(budget)) break;
    visit(child, 1, 0);
  }

  if (!memo) {
    memo = new Map();
    bookmarkTextMemos.set(paragraph, memo);
  }
  memo.set(name, text);
  return text;
}
