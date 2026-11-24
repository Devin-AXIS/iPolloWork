import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import type { CascadedTableFormatting } from './style-cascade.ts';

function childNamed(node: OoxmlElement | undefined, localName: string): OoxmlElement | undefined {
  if (!node) return undefined;
  for (const child of node.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === localName
    ) {
      return child;
    }
  }
  return undefined;
}

function optionalFlag(container: OoxmlElement | undefined): boolean | undefined {
  const flag = childNamed(container, 'tblHeader');
  if (!flag) return undefined;
  const value = flag.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'val'
  )?.value;
  return value === undefined || (value !== '0' && value !== 'false' && value !== 'off');
}

/** Resolve whole-style, conditional-style, then direct `w:tblHeader` toggle precedence. */
export function tableRowIsHeader(
  style: CascadedTableFormatting,
  conditions: readonly string[],
  direct: OoxmlElement | undefined
): boolean {
  let enabled = false;
  for (const properties of style.tableRowPropertyNodes) {
    enabled = optionalFlag(properties) ?? enabled;
  }
  for (const condition of conditions) {
    enabled = optionalFlag(childNamed(style.conditional.get(condition), 'trPr')) ?? enabled;
  }
  return optionalFlag(direct) ?? enabled;
}
