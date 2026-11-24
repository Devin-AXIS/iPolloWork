import { canonicalOoxmlFingerprint, type OoxmlElement } from '@docx-editor.dev/core/store';
import { stableHash } from '../store/comparators/canonical.ts';

// Derived metadata follows resolved level/item identity without widening public records.
const paragraphProperties = new WeakMap<object, OoxmlElement>();
const tokens = new WeakMap<OoxmlElement, string>();
export function withNumberingParagraphProperties<T extends object>(
  value: T,
  node: OoxmlElement | undefined
): T {
  if (node) paragraphProperties.set(value, node);
  return value;
}
export function numberingParagraphProperties(value: object | undefined): OoxmlElement | undefined {
  return value ? paragraphProperties.get(value) : undefined;
}
export function numberingParagraphToken(value: object): string {
  const node = numberingParagraphProperties(value);
  if (!node) return '';
  let token = tokens.get(node);
  if (!token) {
    token = stableHash(canonicalOoxmlFingerprint(node));
    tokens.set(node, token);
  }
  return token;
}
