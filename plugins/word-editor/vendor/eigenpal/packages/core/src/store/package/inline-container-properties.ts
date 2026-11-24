// Structural property children of inline wrappers.

import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlNode } from './ooxml-tree.ts';

/** True for a wrapper property child that contributes no editable inline content. */
export function isInlineContainerProperty(wrapper: OoxmlNode, child: OoxmlNode): boolean {
  if (wrapper.kind === 'textValue' || child.kind === 'textValue') return false;
  if (child.namespaceUri !== WML_NAMESPACE_URI) return false;
  if (wrapper.kind === 'contentControl') {
    return (
      child.kind === 'contentControlProperties' || child.kind === 'contentControlEndProperties'
    );
  }
  if (wrapper.kind !== 'generic' || wrapper.namespaceUri !== WML_NAMESPACE_URI) return false;
  if (wrapper.localName === 'sdt') {
    return child.localName === 'sdtPr' || child.localName === 'sdtEndPr';
  }
  if (wrapper.localName === 'smartTag') return child.localName === 'smartTagPr';
  if (wrapper.localName === 'customXml') return child.localName === 'customXmlPr';
  return false;
}
