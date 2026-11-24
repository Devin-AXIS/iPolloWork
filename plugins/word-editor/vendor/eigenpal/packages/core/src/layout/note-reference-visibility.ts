import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  collectNoteReferences,
  collectProjectedNoteReferences,
} from '../store/package/note-references.ts';
import type { NoteKind } from '../store/package/note-nodes.ts';
import {
  MAX_REVISION_DEPTH,
  isRevisionWrapper,
  revisionAttributionOf,
  revisionFilterSelects,
  revisionsVisible,
  withRevision,
  type RevisionAttribution,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';

function tableRowRevisionAttribution(node: OoxmlNode): RevisionAttribution | null {
  if (node.kind !== 'tableRow') return null;
  const properties = node.children.find(
    (child) => child.namespaceUri === WML_NAMESPACE_URI && child.localName === 'trPr'
  );
  if (!properties) return null;
  let revision: OoxmlElement | null = null;
  for (const child of properties.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName !== 'ins' && child.localName !== 'del') continue;
    revision = child;
    break;
  }
  if (!revision) return null;
  const value = (name: string): string | undefined =>
    revision.attributes.find(
      (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === name
    )?.value;
  const date = value('date');
  return {
    kind: revision.localName === 'ins' ? 'insert' : 'delete',
    id: value('id') ?? '',
    author: value('author') ?? '',
    ...(date === undefined ? {} : { date }),
    nodeId: revision.id,
  };
}

export function noteReferenceVisible(
  ancestors: readonly OoxmlNode[],
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): boolean {
  let revisions: readonly RevisionAttribution[] = [];
  for (const ancestor of ancestors) {
    const attribution = isRevisionWrapper(ancestor)
      ? revisionAttributionOf(ancestor)
      : tableRowRevisionAttribution(ancestor);
    if (!attribution) continue;
    if (revisions.length >= MAX_REVISION_DEPTH) return false;
    revisions = withRevision(revisions, attribution);
  }
  return revisionsVisible(revisions, displayMode, authorFilter);
}

export function noteReferenceRevisionContextKey(ancestors: readonly OoxmlNode[]): string {
  const context: [RevisionAttribution['kind'], string, string][] = [];
  for (const ancestor of ancestors) {
    const revision = isRevisionWrapper(ancestor)
      ? revisionAttributionOf(ancestor)
      : tableRowRevisionAttribution(ancestor);
    if (revision) context.push([revision.kind, revision.nodeId, revision.author]);
  }
  return JSON.stringify(context);
}

/** The body's note references the view shows, in document order. */
export function collectBodyNoteReferences(
  part: OoxmlPart,
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): readonly {
  readonly noteKind: NoteKind;
  readonly noteId: number;
  readonly paragraphId: string;
  readonly atomOffset: number;
  readonly customMarkFollows: boolean;
}[] {
  const unfiltered = displayMode === 'all-markup' && !revisionFilterSelects(authorFilter);
  const hits = unfiltered
    ? collectNoteReferences(part)
    : collectProjectedNoteReferences(part, {
        includeReference: (_node, ancestors) =>
          noteReferenceVisible(ancestors, displayMode, authorFilter),
        projectionKey: `${displayMode};${authorFilter?.cacheKey ?? ''}`,
        ancestryKey: noteReferenceRevisionContextKey,
      });
  return hits.map((hit) => ({
    noteKind: hit.noteKind,
    noteId: hit.noteId,
    paragraphId: hit.paragraphId,
    atomOffset: hit.atomOffset,
    customMarkFollows: hit.customMarkFollows,
  }));
}
