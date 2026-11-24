import type { OoxmlNode } from './ooxml-tree.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';

/**
 * Accessibility-only projection of a legacy field name. Render state deliberately excludes names.
 * Read direct WML children with a fixed budget. A macro-bearing field supplies no accessible name;
 * macro attributes and descendants are never read. The result is plain text, never an instruction.
 */
export function legacyCheckboxAccessibleName(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue') return;
  const data = node.children
    .slice(0, 256)
    .find(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        child.localName === 'ffData'
    );
  if (!data || data.kind === 'textValue' || data.children.length > 256) return;
  if (
    !data.children.some(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        (child.localName === 'checkBox' || child.localName === 'ddList')
    )
  )
    return;
  if (
    data.children.some(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === WML_NAMESPACE_URI &&
        (child.localName === 'entryMacro' || child.localName === 'exitMacro')
    )
  )
    return;
  const name = data.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'name'
  );
  if (!name || name.kind === 'textValue') return;
  return (
    name.attributes
      .slice(0, 64)
      .find(
        (attribute) =>
          attribute.localName === 'val' &&
          (attribute.namespaceUri === WML_NAMESPACE_URI || attribute.namespaceUri === '')
      )
      ?.value.slice(0, 256)
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
      .trim() || undefined
  );
}
