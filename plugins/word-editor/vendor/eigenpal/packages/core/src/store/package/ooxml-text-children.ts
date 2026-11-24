// Which raw text children an element keeps, shared by the one-shot and the stepped part read.

import type { XmlNode } from './xml-reader.ts';

/** Text that is insignificant between children when no `xml:space="preserve"` is in scope. */
export const BLANK_TEXT = /^\s*$/;

/**
 * Text that is indentation under an inherited `xml:space="preserve"`: XML whitespace only
 * (`S` in XML 1.0). `\s` also matches U+00A0, U+3000 and U+FEFF, which are authored
 * characters here; any of them keeps every text node and the generic fallback.
 */
export const XML_INDENTATION_TEXT = /^[ \t\r\n]*$/;

export function canonicalLegacyChildren(
  children: readonly XmlNode[],
  preserve: boolean,
  isWmlText: boolean,
  blank: RegExp = BLANK_TEXT
): readonly XmlNode[] {
  // Whitespace stripping and adjacent-text merging only apply to TEXT children; the
  // structural bulk of a part has none, and skipping the filter/merge allocation there
  // is a measurable parse win on long documents.
  if (!children.some((child) => child.type === 'text')) return children;
  const hasElement = children.some((child) => child.type === 'element');
  const hasNonWhitespaceText = children.some(
    (child) => child.type === 'text' && !blank.test(child.value)
  );
  const retained = children.filter(
    (child) =>
      child.type === 'element' ||
      preserve ||
      isWmlText ||
      !hasElement ||
      hasNonWhitespaceText ||
      !blank.test(child.value)
  );
  const merged: XmlNode[] = [];
  for (const child of retained) {
    const previous = merged[merged.length - 1];
    if (child.type === 'text' && previous?.type === 'text') {
      merged[merged.length - 1] = {
        type: 'text',
        value: previous.value + child.value,
      };
    } else {
      merged.push(child);
    }
  }
  return merged;
}
