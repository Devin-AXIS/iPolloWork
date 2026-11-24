import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import {
  revisionNodeIncluded,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import type { TableCellFragmentRecord } from './semantic-records.ts';

/** Classify visible cell changes without changing authored shading. */
export function revisionCellShading(
  properties: OoxmlElement | undefined,
  mode: RevisionDisplayMode,
  filter: RevisionAuthorFilter | undefined
): TableCellFragmentRecord['revisionShading'] {
  if (mode !== 'all-markup' || !properties) return undefined;
  const revision = cellRevision(properties);
  if (!revision) return undefined;
  const attribute = (name: string) =>
    revision.attributes.find(
      (item) => item.localName === name && item.namespaceUri === WML_NAMESPACE_URI
    )?.value;
  if (filter && !revisionNodeIncluded(filter, revision.id, attribute('author') ?? ''))
    return undefined;
  if (revision.localName === 'cellIns') return 'inserted';
  if (revision.localName === 'cellDel') return 'deleted';
  return attribute('vMergeOrig') === 'cont' && attribute('vMerge') !== 'cont' ? 'split' : 'merged';
}

function cellRevision(properties: OoxmlElement): OoxmlElement | undefined {
  const revision = properties.children.find(
    (node) =>
      node.kind !== 'textValue' &&
      node.namespaceUri === WML_NAMESPACE_URI &&
      ['cellIns', 'cellDel', 'cellMerge'].includes(node.localName)
  );
  return revision?.kind !== 'textValue' ? revision : undefined;
}

/** Publish cell revision metadata only when a visible cell revision exists. */
export function revisionCellMetadata(
  properties: OoxmlElement | undefined,
  mode: RevisionDisplayMode,
  filter: RevisionAuthorFilter | undefined,
  rowRevision?: OoxmlElement
): Pick<TableCellFragmentRecord, 'revisionShading' | 'revisionShadingAuthor'> {
  const cellShading = revisionCellShading(properties, mode, filter);
  const revisionShading =
    cellShading ??
    (mode === 'all-markup' && rowRevision
      ? rowRevision.localName === 'ins'
        ? 'inserted'
        : 'deleted'
      : undefined);
  if (!revisionShading) return {};
  const revision = cellShading && properties ? cellRevision(properties) : rowRevision;
  const revisionShadingAuthor =
    revision?.attributes.find(
      (item) => item.localName === 'author' && item.namespaceUri === WML_NAMESPACE_URI
    )?.value ?? '';
  return { revisionShading, revisionShadingAuthor };
}

export function wmlRevisionChild(
  node: OoxmlElement,
  localName: 'trPr' | 'ins' | 'del'
): OoxmlElement | undefined {
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

export function wmlRevisionAttribute(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName
  )?.value;
}
