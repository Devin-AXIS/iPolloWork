// A paragraph's outline level (`w:outlineLvl`, §17.3.1.20): 0-8 for a heading level, null for
// body text.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import type { StyleCascadeTable } from './style-cascade.ts';
import { styleChain } from './style-chain.ts';

/**
 * The outline level of a paragraph from its cascaded properties and its style.
 *
 * A stated `w:outlineLvl` wins, and 9 or an invalid value states body text. Without one,
 * the nearest style in the `w:basedOn` chain that states a level decides. Built-in Heading
 * styles remain semantic even when a producer omits styles.xml (or names one without
 * defining it), so every exporter agrees.
 */
export function resolveParagraphOutlineLevel(
  props: readonly OoxmlProperty[],
  styleCascade: StyleCascadeTable | undefined,
  styleId: string | null
): number | null {
  let outlineLevel: number | null = null;
  let sawOutlineProperty = false;
  for (const property of props) {
    if (property.localName !== 'outlineLvl') continue;
    sawOutlineProperty = true;
    const value = property.attributes?.val;
    outlineLevel = value !== undefined && /^[0-8]$/.test(value) ? Number(value) : null;
  }
  if (!sawOutlineProperty && styleCascade && styleId) {
    const chain = styleChain(styleCascade, styleId, 'paragraph');
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const inherited = chain[index]!.outlineLevel;
      if (inherited !== null) {
        outlineLevel = inherited;
        break;
      }
    }
  }
  if (!sawOutlineProperty && outlineLevel === null && styleId) {
    const builtIn = /^heading\s*([1-9])$/i.exec(styleId.trim());
    if (builtIn) outlineLevel = Number(builtIn[1]) - 1;
  }
  return outlineLevel;
}
