// Raw paragraph text in the canonical model offset vocabulary.

import { inlineCharacterTextOf, isSymbolElement, SYMBOL_TEXT } from '../package/hyphen-text.ts';
import { fieldAtomText } from '../package/field-nodes.ts';
import { hardBreakKind, hardBreakText } from '../package/hard-break.ts';
import type { OoxmlPart, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { findNode } from '../package/ooxml-edit.ts';
import { withFieldResultsMode, type FieldResultsMode } from '../package/field-result-mode.ts';
import { isParagraph, segmentsOf } from './tree-op-segments.ts';

/**
 * Paragraph text as the ops address it, for tests and callers computing offsets.
 *
 * `fieldResults` defaults to the mode of the store call in progress, which is `atomic` outside
 * any editable transaction: every field is one unit, the raw text collaboration and
 * automation read. `editable` reads saved field results as text, as an editor in that mode
 * addresses them.
 */
export function paragraphTextOf(
  part: OoxmlPart,
  paragraphId: string,
  options?: { readonly fieldResults?: FieldResultsMode }
): string | null {
  return withFieldResultsMode(options?.fieldResults, () => {
    const paragraph = findNode(part, paragraphId);
    return isParagraph(paragraph) ? paragraphModelTextOf(paragraph) : null;
  });
}

/** Paragraph text as the ops address it, from one canonical paragraph node. @internal */
export function paragraphModelTextOf(paragraph: OoxmlParagraphNode): string {
  let text = '';
  for (const segment of segmentsOf(paragraph)) {
    if (segment.removeNodeIds && segment.removeNodeIds.length > 0) {
      text += fieldAtomText();
      continue;
    }
    if (segment.node.kind === 'textValue') text += segment.node.value;
    else if (segment.node.kind === 'tab') text += '\t';
    else if (segment.node.kind === 'hardBreak') text += hardBreakText(segment.node);
    else if (inlineCharacterTextOf(segment.node) !== null)
      text += inlineCharacterTextOf(segment.node);
    else if (
      segment.node.kind === 'fldChar' ||
      segment.node.kind === 'fldSimple' ||
      (segment.node.kind === 'generic' &&
        (segment.node.localName === 'fldChar' || segment.node.localName === 'fldSimple'))
    ) {
      text += fieldAtomText();
    }
  }
  return text;
}

/**
 * Paragraph model text with its symbols left out. A symbol reads as "(" in model text; text
 * that is written back as plain characters, such as a heading's table of contents row, must
 * not turn it into a parenthesis. @internal
 */
export function withoutSymbols(paragraph: OoxmlParagraphNode, text: string): string {
  if (!text.includes(SYMBOL_TEXT)) return text;
  let kept = '';
  let at = 0;
  for (const segment of segmentsOf(paragraph)) {
    if (!isSymbolElement(segment.node) || segment.start < at) continue;
    kept += text.slice(at, segment.start);
    at = segment.end;
  }
  return kept + text.slice(at);
}

/** A symbol's `w:font` and `w:char`, as the file wrote them. @internal */
export interface ParagraphSymbol {
  readonly font: string | null;
  readonly char: string;
}

/**
 * Paragraph model text with each symbol replaced by `mark`, and the symbols in order. Text
 * that already holds `mark` loses it first, so every mark left stands for one symbol. @internal
 */
export function withSymbolMarks(
  paragraph: OoxmlParagraphNode,
  text: string,
  mark: string
): { readonly text: string; readonly symbols: readonly ParagraphSymbol[] } {
  const symbols: ParagraphSymbol[] = [];
  let marked = '';
  let at = 0;
  for (const segment of segmentsOf(paragraph)) {
    const node = segment.node;
    if (node.kind === 'textValue' || !isSymbolElement(node) || segment.start < at) continue;
    const attribute = (name: string) =>
      node.attributes.find((entry) => entry.localName === name)?.value ?? null;
    const char = attribute('char');
    if (char === null) continue;
    marked += text.slice(at, segment.start).replaceAll(mark, '') + mark;
    symbols.push({ font: attribute('font'), char });
    at = segment.end;
  }
  return { text: marked + text.slice(at).replaceAll(mark, ''), symbols };
}

/** How a text read spells a manual line break: the character a text write uses for one. */
export const LINE_BREAK_READ_TEXT = '\v';
/** How a text read spells a column break. Text writes refuse it, so it is never rewritten. */
export const COLUMN_BREAK_READ_TEXT = '\u000e';

/**
 * Paragraph model text with each break spelled as a text read spells it: `\v` for a line break
 * and U+000E for a column break. Model text spells both `\n`; every spelling is one UTF-16 unit,
 * so offsets do not change. A break of a kind this engine does not model keeps `\n`. @internal
 */
export function withBreakReadText(paragraph: OoxmlParagraphNode, text: string): string {
  if (!text.includes('\n')) return text;
  let read = '';
  let at = 0;
  for (const segment of segmentsOf(paragraph)) {
    if (segment.node.kind !== 'hardBreak' || text[segment.start] !== '\n') continue;
    const kind = hardBreakKind(segment.node);
    const spelled =
      kind === 'line' ? LINE_BREAK_READ_TEXT : kind === 'column' ? COLUMN_BREAK_READ_TEXT : '\n';
    read += text.slice(at, segment.start) + spelled;
    at = segment.start + 1;
  }
  return read + text.slice(at);
}
