// Where a numbering level's `w:pPr` ranks among a list paragraph's own formatting.

import type { OoxmlNode } from '@docx-editor.dev/core/store';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { propertiesOf } from './paragraph-flow.ts';
import { paragraphStyleChain } from './style-chain.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import { isElement, type StyleDefinition } from './style-definition-reader.ts';

/** Whether this `w:pPr` states a `w:numPr`, whatever the `w:numPr` holds. */
function statesNumPr(pPr: OoxmlNode | undefined): boolean {
  return (
    pPr !== undefined &&
    isElement(pPr) &&
    pPr.children.some((child) => isElement(child) && child.localName === 'numPr')
  );
}

/**
 * How many styles of the base-first `chain` rank BELOW the numbering level.
 *
 * The level sits directly below the nearest `w:pPr` that states a `w:numPr`, whether that
 * `w:numPr` names the `w:numId`, only a `w:ilvl`, or both. A paragraph with its own
 * `w:numPr` puts the level above the whole chain. Otherwise the nearest style stating one
 * and the styles based on it outrank the level, and its bases do not. This holds for every
 * property of the level's `w:pPr`: indents, spacing, alignment and tabs alike. A base style
 * with a first-line indent, left alignment or a cleared tab stop leaves the level's values
 * in place, and a value the style that states the `w:numPr` gives itself replaces the
 * level's. A child style that states only `w:ilvl` therefore ranks its base's indent below
 * the level it picks.
 */
export function numberingLevelRank(
  chain: readonly StyleDefinition[],
  directPPr: OoxmlNode | undefined
): number {
  if (statesNumPr(directPPr)) return chain.length;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (statesNumPr(chain[index]!.paragraphPropertiesNode)) return index;
  }
  return 0;
}

/**
 * A list paragraph's inherited properties split around its numbering level at
 * `numberingLevelRank`: `below` is what the level outranks and `above` is what outranks it.
 * Concatenated, the two are the cascade order.
 */
export function numberingLevelTiers(
  table: StyleCascadeTable,
  styleId: string | null,
  directPPr: OoxmlNode | undefined
): { readonly below: readonly OoxmlProperty[]; readonly above: readonly OoxmlProperty[] } {
  const chain = paragraphStyleChain(table, styleId);
  const rank = numberingLevelRank(chain, directPPr);
  return {
    below: [
      ...table.docDefaultsParagraph,
      ...chain.slice(0, rank).flatMap((style) => style.paragraphProperties),
    ],
    above: [
      ...chain.slice(rank).flatMap((style) => style.paragraphProperties),
      ...propertiesOf(directPPr),
    ],
  };
}
