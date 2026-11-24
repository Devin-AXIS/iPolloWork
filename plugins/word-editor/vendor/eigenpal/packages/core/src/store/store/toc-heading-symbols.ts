// The symbols a table of contents row copies from its heading.
//
// A TOC op carries each row's text as its heading's outline entry reads, which leaves symbols
// out. Applying the op reads the heading paragraph itself from canonical content and, when its
// text is the row's text, writes the row with the heading's symbols in place. Every replica
// derives the same row from the same tree, so the op carries nothing new.

import { findNode } from '../package/ooxml-edit.ts';
import { withDisplayedHyphens } from '../package/hyphen-text.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';
import { tocEntryText, type TocEntryPlan } from '../package/toc-build.ts';
import { TOC_SYMBOL_MARK } from '../package/toc-symbol-text.ts';
import { paragraphModelTextOf, withSymbolMarks } from './paragraph-model-text.ts';

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
/** The outline's own bound on heading text (`binding/document-outline.ts`). */
const HEADING_TEXT_MAX = 200;

/**
 * The outline's bound applied to marked text: marks do not count, and leading whitespace
 * after a mark does not either, since the outline trims the text with its symbols left out.
 */
function sliceUnmarked(text: string): string {
  let kept = '';
  let counted = 0;
  let started = false;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]!;
    if (char !== TOC_SYMBOL_MARK && !started && /\s/.test(char)) {
      kept += char;
      continue;
    }
    if (char !== TOC_SYMBOL_MARK) {
      if (counted === HEADING_TEXT_MAX) break;
      started = true;
      counted += 1;
    }
    kept += char;
  }
  return kept;
}

/** The entry with its heading's symbols, or the entry unchanged when there are none. */
export function withHeadingSymbols(part: OoxmlPart, entry: TocEntryPlan): TocEntryPlan {
  const heading = findNode(part, entry.headingParagraphId);
  if (!heading || heading.kind !== 'paragraph') return entry;
  const marked = withSymbolMarks(heading, paragraphModelTextOf(heading), TOC_SYMBOL_MARK);
  if (marked.symbols.length === 0) return entry;
  const rowText = tocEntryText(
    sliceUnmarked(withDisplayedHyphens(marked.text).replace(CONTROL_CHARS, ' ').trim())
  );
  // Only a row that is this heading's text gets its symbols; any other text is kept as given.
  if (tocEntryText(rowText.replaceAll(TOC_SYMBOL_MARK, '')) !== entry.text) return entry;
  const kept = rowText.split(TOC_SYMBOL_MARK).length - 1;
  return { ...entry, text: rowText, symbols: marked.symbols.slice(0, kept) };
}
