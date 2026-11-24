// `w:tabs` as Word's `tab-stops` CSS, for the HTML clipboard writer.

import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';
import { isElement, parseTwipsValue, ptFromTwips, wmlVal } from './clipboard-html-write-tree.ts';

/** The `tab-stops` rule for a paragraph's `w:tabs`, or null when it states no usable stop. */
export function wordTabStopsCss(tabs: OoxmlElement | undefined | null): string | null {
  if (!tabs) return null;
  const values: string[] = [];
  for (const child of tabs.children) {
    if (!isElement(child) || child.localName !== 'tab') continue;
    const val = wmlVal(child);
    const pos = parseTwipsValue(attributeValueOf(child, 'pos', WML_NAMESPACE_URI));
    if (
      pos === null ||
      pos < 0 ||
      (val !== 'left' && val !== 'center' && val !== 'right' && val !== 'decimal' && val !== 'bar')
    ) {
      continue;
    }
    const leader = wmlVal(child, 'leader');
    // The read side accepts every token here, so the engine's own round trip
    // keeps middleDot and heavy leaders too.
    const cssLeader =
      leader === 'dot'
        ? 'dotted'
        : leader === 'hyphen'
          ? 'dashed'
          : leader === 'underscore'
            ? 'lined'
            : leader === 'middleDot'
              ? 'middledot'
              : leader === 'heavy'
                ? 'heavy'
                : '';
    values.push(`${val}${cssLeader ? ` ${cssLeader}` : ''} ${ptFromTwips(pos)}`);
  }
  return values.length > 0 ? `tab-stops:${values.join(' ')}` : null;
}
