// A heading's symbols, carried into the table of contents row built from it.
//
// A heading's outline entry leaves its symbols out: its text is for reading and matching, and a
// symbol reads as "(" in model text. A table of contents row copies the heading's symbols as
// `w:sym` elements with their own face and character. The row text holds one mark per symbol,
// and the row builder writes each mark back as the symbol it stands for.

import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlNode } from './ooxml-tree.ts';

/** Stands for one symbol in a row text: a noncharacter, which no heading text keeps. */
export const TOC_SYMBOL_MARK = '\ufdd0';

/** One heading symbol: its `w:font` and `w:char`, as the file wrote them. */
export interface TocSymbol {
  readonly font: string | null;
  readonly char: string;
}

/** A `w:sym` element for one heading symbol. */
export function tocSymbolNode(mint: () => string, symbol: TocSymbol): OoxmlNode {
  const attribute = (localName: string, value: string) => ({
    kind: 'genericExtension' as const,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    value,
  });
  return {
    id: mint(),
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'sym',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [
      ...(symbol.font === null ? [] : [attribute('font', symbol.font)]),
      attribute('char', symbol.char),
    ],
    children: [],
  } as unknown as OoxmlNode;
}
