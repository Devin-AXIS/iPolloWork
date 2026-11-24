import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import { isRangeMarkerKind } from '../package/ooxml-shared.ts';

/** Empty revision markers cannot contain preserved content. */
export function hasRevisionMarkerContent(node: OoxmlElement): boolean {
  return node.children.some((child) => child.kind !== 'textValue' || child.value.trim().length > 0);
}

/**
 * A child that marks a position rather than holding content: bookmark, comment-range and
 * move-range boundaries, permission-range boundaries, and proofing marks.
 */
export function isInertMarker(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  if (node.kind === 'bookmarkStart' || node.kind === 'bookmarkEnd') return true;
  if (isRangeMarkerKind(node.kind)) return true;
  return (
    node.kind === 'generic' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    (node.localName === 'proofErr' ||
      node.localName === 'permStart' ||
      node.localName === 'permEnd')
  );
}

/**
 * A `w:pPr` or `w:rPr` that a paragraph-mark stamp created and that held nothing but the
 * revision marks this resolution drops.
 *
 * Proposing a paragraph-mark change writes those containers when the paragraph had none, with
 * ids in the `mark` family, so resolving the proposal removes them again. Rejecting a proposed
 * mark deletion then restores the paragraph as it was. A container the source already had
 * keeps its id and stays, even when empty. In a document reopened from saved bytes, ids carry
 * no history, and on another collaboration replica the container has a replica-scoped id, so
 * there an emptied container stays as an empty element.
 *
 * An inserted mark that is ACCEPTED is the exception: the paragraph it made is permanent and
 * no reject can restore an earlier state, so a container that held nothing but accepted
 * marks goes whatever its id. Without that, accepting a split in a reopened document left
 * `<w:pPr><w:rPr/></w:pPr>` on the paragraph.
 */
export function heldOnlyResolvedMarks(
  node: OoxmlNode,
  dropped: ReadonlySet<string>,
  accepted: ReadonlySet<string> = new Set()
): boolean {
  if (node.kind === 'textValue' || node.children.length === 0) return false;
  if (acceptedOnly(node, accepted)) return true;
  // Only a container a mark stamp created; a source container stays, empty or not.
  if (!node.id.slice(node.id.lastIndexOf('#') + 1).startsWith('mark:')) return false;
  const markProperties =
    node.kind === 'runProperties' ||
    (node.kind === 'generic' &&
      node.namespaceUri === WML_NAMESPACE_URI &&
      node.localName === 'rPr');
  if (node.kind !== 'paragraphProperties' && !markProperties) return false;
  return node.children.every((child) =>
    markProperties ? dropped.has(child.id) : heldOnlyResolvedMarks(child, dropped)
  );
}

/** A `w:pPr`, or its `w:rPr`, that held nothing but marks accepted for good. */
function acceptedOnly(node: OoxmlNode, accepted: ReadonlySet<string>): boolean {
  if (node.kind === 'textValue' || node.children.length === 0 || accepted.size === 0) return false;
  if (
    node.kind === 'runProperties' ||
    (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'rPr')
  )
    return node.children.every((child) => accepted.has(child.id));
  if (node.kind !== 'paragraphProperties') return false;
  return node.children.every((child) => acceptedOnly(child, accepted));
}
