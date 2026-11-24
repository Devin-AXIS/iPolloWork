import type { RevisionAttributionInput } from './tree-op-validate.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';

function attr(localName: string, value: string) {
  return {
    kind: 'genericExtension' as const,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    value,
  };
}

export function build(
  id: string,
  kind: OoxmlElement['kind'],
  localName: string,
  attributes: OoxmlElement['attributes'],
  children: readonly OoxmlNode[]
): OoxmlElement {
  return {
    id,
    kind,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes,
    children,
  } as OoxmlElement;
}

/** The `CT_TrackChange` attribute triple, shared by every tracked wrapper writer. */
export function revisionAttributes(id: string, revision: RevisionAttributionInput) {
  const attributes = [attr('id', id), attr('author', revision.author)];
  if (revision.date !== undefined) attributes.push(attr('date', revision.date));
  return attributes;
}
