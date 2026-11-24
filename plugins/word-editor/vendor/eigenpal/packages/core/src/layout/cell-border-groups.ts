// `w:between` border grouping for paragraphs inside a `w:tc` (ECMA-376 §17.3.1.24).
//
// Word treats consecutive paragraphs whose border settings are IDENTICAL as ONE bordered
// block: the top rule draws above the first, the bottom rule below the last, and every
// interior boundary carries `w:between` or nothing. Applying a box to three selected
// paragraphs draws one box, not three. Body flow does this from a prepared array that already
// holds every block's resolved borders; cell flow places one paragraph at a time, so it needs
// a way to ask a NEIGHBOUR for the same identity without paying the neighbour's cascade twice.
//
// That is what this module is. The key is memoized per paragraph node, and the cache is a
// `WeakMap` on the node itself: an edit replaces the node, which retires the entry with it.
// `placeCellParagraph` seeds the entry from the cascade it already ran, so an UNBORDERED
// paragraph — nearly every paragraph in a document — costs one map write and no extra work,
// and only a paragraph that actually carries `w:pBdr` ever makes a neighbour resolve.

import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import { paragraphBoxOutdent } from './paragraph-indent.ts';
import { paragraphIsRtl } from './rtl-paragraph.ts';
import { paragraphBordersFingerprint, type ParagraphBorders } from './paragraph-style.ts';
import {
  resolveParagraphLayoutInputs,
  type StyleCascadeTable,
  type TableCellStyleFormatting,
} from './style-cascade.ts';
import type { ResolvedListItem } from './list-resolve.ts';

/** Everything that can change what a paragraph's borders and indent resolve to. */
export interface CellBorderGroupContext {
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly tableCellStyle: TableCellStyleFormatting | undefined;
  readonly listItems: ReadonlyMap<string, ResolvedListItem> | undefined;
}

interface CellBorderGroupMemo {
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly tableCellStyle: TableCellStyleFormatting | undefined;
  readonly listItem: ResolvedListItem | undefined;
  readonly key: string;
}

const memos = new WeakMap<OoxmlElement, CellBorderGroupMemo>();

/**
 * The group identity of one paragraph: its border set plus its own box INSETS, measured to
 * the box edges (see `paragraphBoxOutdent`).
 *
 * ONE definition for both flows. Body flow and cell flow have to spell this key identically
 * or the same authored callout groups in a `w:tc` and not in the body, which is the drift
 * this module exists to prevent; a second hand-inlined copy of the string would be exactly
 * that drift waiting to happen.
 *
 * The insets and not `available`: `available` folds in the content width, and the same
 * authored paragraph in two columns of different width would then never group with itself.
 *
 * EVERY FIELD IN THIS KEY MUST BE WIDTH-INDEPENDENT. `cellBorderGroupKey` resolves a
 * NEIGHBOUR at a content width of 1 while `placeCellParagraph` seeds the memo at the real
 * cell width, so a width-dependent field would make grouping asymmetric — A would group with
 * B while B did not group with A, and which of the two ran first would decide what was
 * painted. `borders`, `w:ind` and `w:bidi` are all width-independent today.
 *
 * Empty string means "no borders", which groups with nothing.
 */
export function paragraphBorderGroupKey(inputs: {
  readonly borders: ParagraphBorders;
  readonly indent: {
    readonly left: number;
    readonly right: number;
    readonly hanging: number;
    readonly firstLine: number;
  };
  readonly props: readonly OoxmlProperty[];
}): string {
  const token = paragraphBordersFingerprint(inputs.borders);
  if (token === '') return '';
  // The box edges, not the text indents: a hanging paragraph whose first line starts at the
  // margin shares a box with a flush one, and two paragraphs with equal `w:left` whose first
  // lines start apart do not.
  const outdent = paragraphBoxOutdent(inputs.indent, paragraphIsRtl(inputs.props));
  const { left, right } = inputs.indent;
  return `${token}@${left - outdent.left},${right - outdent.right}`;
}

/** Record the key a caller already resolved, so a neighbour lookup is a map read. */
export function rememberCellBorderGroupKey(
  paragraph: OoxmlElement,
  context: CellBorderGroupContext,
  key: string
): void {
  memos.set(paragraph, {
    styleCascade: context.styleCascade,
    tableCellStyle: context.tableCellStyle,
    listItem: context.listItems?.get(paragraph.id),
    key,
  });
}

/**
 * The group identity of a cell paragraph, resolving its cascade only on a memo miss.
 *
 * Asked with a content width of 1: the key reads the resolved borders and `w:ind` left/right,
 * and neither depends on the width the paragraph is laid out at.
 */
export function cellBorderGroupKey(
  paragraph: OoxmlElement,
  context: CellBorderGroupContext
): string {
  const listItem = context.listItems?.get(paragraph.id);
  const cached = memos.get(paragraph);
  if (
    cached &&
    cached.styleCascade === context.styleCascade &&
    cached.tableCellStyle === context.tableCellStyle &&
    cached.listItem === listItem
  ) {
    return cached.key;
  }
  const key = paragraphBorderGroupKey(
    resolveParagraphLayoutInputs(
      paragraph,
      1,
      context.styleCascade,
      listItem,
      context.tableCellStyle,
      true
    )
  );
  rememberCellBorderGroupKey(paragraph, context, key);
  return key;
}

/** The neighbour's key, or the empty string when there is no paragraph on that side. */
export function neighbourBorderGroupKey(
  block: OoxmlElement | undefined,
  context: CellBorderGroupContext
): string {
  return block && block.kind === 'paragraph' ? cellBorderGroupKey(block, context) : '';
}

/** Reuse the current paragraph's resolution when checking its cell neighbours. */
export function cellBorderContinuation(
  paragraph: OoxmlElement,
  key: string,
  context: CellBorderGroupContext,
  neighbours?: {
    readonly previous: OoxmlElement | undefined;
    readonly next: OoxmlElement | undefined;
  }
): { readonly continuesAbove: boolean; readonly continuesBelow: boolean } {
  rememberCellBorderGroupKey(paragraph, context, key);
  const matches = (block: OoxmlElement | undefined): boolean =>
    key !== '' && neighbourBorderGroupKey(block, context) === key;
  return {
    continuesAbove: matches(neighbours?.previous),
    continuesBelow: matches(neighbours?.next),
  };
}
