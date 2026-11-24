import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import {
  readDocumentProtection,
  trackedChangesProtectionRefusal,
} from '../package/document-protection.ts';
import type { TreeDocOp } from './tree-op-types.ts';
import type { TreeOpRejection } from './tree-op-validate.ts';

/**
 * The refusal a PACKAGE-level commit gets: furniture and note lifecycle, and the package edit
 * channel, none of which reach the per-op applier.
 *
 * FORMS protection refuses here as well, which `documentProtectionRefusal` alone does not do.
 * Forms protection inverts the usual rule — the document is read-only EXCEPT inside a form
 * field — and a package-level commit is never inside one: creating a header, inserting a note
 * or setting a section flag is document-scoped by construction. Reading only the two
 * document-wide modes let a forms-protected document answer "Insert footnote" with a new
 * `footnotes.xml` while refusing a keystroke in the same paragraph.
 *
 * The protection toggle is exempt, and the exemption is the point: it is the command that
 * LIFTS the lock, and a guard that trapped it would leave the reader with no way back in.
 */
export function lifecycleProtectionRefusal(
  settings: OoxmlPart | null | undefined,
  op: { readonly op: string }
): TreeOpRejection | null {
  if (op.op === 'setDocumentProtection') return null;
  const protection = readDocumentProtection(settings?.root);
  if (protection.enforced && protection.edit === 'forms') return 'locked';
  if (
    protection.enforced &&
    protection.edit === 'comments' &&
    ['comment', 'setCommentResolved', 'setCommentText', 'deleteComments'].includes(op.op)
  )
    return null;
  return documentProtectionRefusal(settings);
}

/**
 * The refusal an enforced `readOnly` or `comments` protection gives a write.
 *
 * Read-only admits no edit. Comments-only admits comment anchors; the package channel
 * admits only callbacks from the internal comment writers. Generic package edits stay locked.
 * Forms and tracked-changes protection have their own field and editing-mode checks.
 * Exception ranges are not supported.
 */
export function documentProtectionRefusal(
  settings: OoxmlPart | null | undefined,
  op?: TreeDocOp
): TreeOpRejection | null {
  const protection = readDocumentProtection(settings?.root);
  if (!protection.enforced) return null;
  if (protection.edit === 'readOnly') return 'locked';
  if (protection.edit === 'comments' && op?.op !== 'insertCommentMarker') return 'locked';
  // Tracked-changes protection keeps each change attributed to the person who made it.
  if (
    op?.op === 'setRevisionAttribution' &&
    trackedChangesProtectionRefusal(protection, 'attribute')
  )
    return 'locked';
  return null;
}

/**
 * Whether `settings.xml` enforces `w:documentProtection w:edit="forms"` (§17.15.1.29).
 *
 * Enforcement is a separate attribute from the mode: Word stores the mode a document was last
 * protected with even after the protection is lifted, so a file with `w:enforcement="0"` is an
 * ordinary editable document and treating it as protected would lock users out of their own
 * text.
 */
export function enforcesFormsProtection(settings: OoxmlPart | null | undefined): boolean {
  return formsProtectionEnabled(settings?.root);
}

/**
 * Read forms protection from the settings root.
 *
 * Delegates to the ONE parse of `w:documentProtection` rather than reading the element again:
 * a second reading of `@w:enforcement` is how a document ends up protected to the Review menu
 * and unprotected to the store.
 */
export function formsProtectionEnabled(root: OoxmlNode | null | undefined): boolean {
  const protection = readDocumentProtection(root);
  return protection.edit === 'forms' && protection.enforced;
}

/** `ST_OnOff`: absent means on for a flag element, and "0"/"false"/"off" always means off. */
function isTrue(value: string | undefined): boolean {
  if (value === undefined) return true;
  return value !== '0' && value !== 'false' && value !== 'off';
}

/**
 * Whether the section owning a node still has form protection on.
 *
 * `w:formProt` is per-section, so a protected document may carry an unprotected section. The
 * owning section is the first `w:sectPr` at or after the node in body order, which is how a
 * section's extent is expressed in the body at all.
 */
export function sectionProtectsForms(part: OoxmlPart, nodeId: string): boolean {
  let seenTarget = false;
  let answer = true;
  const walk = (node: OoxmlNode): boolean => {
    if (node.kind === 'textValue') return false;
    if (node.id === nodeId) seenTarget = true;
    if (
      seenTarget &&
      node.namespaceUri === WML_NAMESPACE_URI &&
      node.localName === 'sectPr' &&
      node.id !== nodeId
    ) {
      const formProt = node.children.find(
        (child) =>
          child.kind !== 'textValue' &&
          child.namespaceUri === WML_NAMESPACE_URI &&
          child.localName === 'formProt'
      );
      // No `w:formProt` on the section leaves the document's own protection in force.
      if (formProt && formProt.kind !== 'textValue') {
        answer = isTrue(
          formProt.attributes.find(
            (entry) => entry.localName === 'val' && entry.namespaceUri === WML_NAMESPACE_URI
          )?.value
        );
      }
      return true;
    }
    for (const child of node.children) {
      if (walk(child)) return true;
    }
    return false;
  };
  walk(part.root);
  return answer;
}
