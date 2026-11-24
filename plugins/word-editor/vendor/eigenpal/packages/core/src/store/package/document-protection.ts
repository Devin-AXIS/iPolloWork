// What `settings.xml` says about DOCUMENT PROTECTION (`w:documentProtection`, §17.15.1.29).
//
// One reader for the one element, so the mode pill, the Review menu toggle, the store's
// refusals and the tracking settings all answer from the same parse. The element carries
// three separable facts:
//
//   - `@w:edit` (`ST_DocProtect`): WHICH restriction the document asks for — none, read-only,
//     comments only, tracked changes only, or filling in forms.
//   - `@w:enforcement`: whether that restriction is IN FORCE. Word keeps the mode a document
//     was last protected with after Stop Protection, so a file with `w:enforcement="0"` is an
//     ordinary editable document that remembers a preference. ABSENT is the same answer: this
//     is an `ST_OnOff` ATTRIBUTE, not a `CT_OnOff` element, so there is no presence to read as
//     a yes, and Word writes `w:enforcement="1"` whenever it protects. Reading absence as
//     enforced makes a document from a producer that omits one attribute completely dead.
//   - `AG_Password` (`@w:hash`, `@w:salt`, the newer `algorithm*`/`hashValue`/`saltValue`
//     group, and the 2007 `crypt*` set): whether lifting the protection needs a password. The
//     hash is never verified here — protection is advisory, not a security boundary, and the
//     file is editable by anyone holding it — but a protection Word would ask a password for
//     is not one this editor lifts silently.
//
// THE ONLY reader of this element. `enforcesFormsProtection` and `readTrackingSettings` both
// answer from it, because two readings of `@w:enforcement` meant a document could be protected
// to the Review menu and unprotected to the store. Reading only; the write is
// `applyDocumentProtection` in `settings-write.ts`, which needs the package plumbing.

import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { isSettingsElement, settingsAttributeValue, settingsChildNamed } from './settings-onoff.ts';

/** `ST_DocProtect`: the restriction a document asks for. `none` also stands for "no element". */
export type DocumentProtectionEdit = 'none' | 'readOnly' | 'comments' | 'trackedChanges' | 'forms';

/** The document's protection, as the file states it. */
export interface DocumentProtectionState {
  /** The restriction named by `@w:edit`; `none` when absent or unrecognised. */
  readonly edit: DocumentProtectionEdit;
  /** True when `@w:enforcement` puts that restriction in force. Always false for `none`. */
  readonly enforced: boolean;
  /** True when lifting the protection would ask for a password in Word. */
  readonly password: boolean;
}

/** The frozen "not protected" state — what a document with no settings part gets. */
export const NO_DOCUMENT_PROTECTION: DocumentProtectionState = Object.freeze({
  edit: 'none',
  enforced: false,
  password: false,
});

const EDIT_VALUES: ReadonlySet<string> = new Set([
  'none',
  'readOnly',
  'comments',
  'trackedChanges',
  'forms',
]);

/**
 * The `AG_Password` attribute group on `CT_DocProtect`: the `algorithm*` group the schema
 * declares, the older `hash`/`salt` pair, and the 2007 transitional `crypt*` set.
 *
 * Exported so the write can strip exactly this group when it re-arms a protection, rather
 * than restating the list and drifting from it.
 */
export const PASSWORD_ATTRIBUTES: ReadonlySet<string> = new Set([
  'hash',
  'salt',
  'algorithmName',
  'hashValue',
  'saltValue',
  'spinCount',
  'cryptProviderType',
  'cryptAlgorithmClass',
  'cryptAlgorithmType',
  'cryptAlgorithmSid',
  'cryptSpinCount',
  'cryptProvider',
  'algIdExt',
  'algIdExtSource',
  'cryptProviderTypeExt',
  'cryptProviderTypeExtSource',
]);

/**
 * Whether the element carries any password attribute.
 *
 * Namespace-checked like every other read here. Matching on the local name alone let one
 * foreign-namespace attribute named `salt` — which costs a sender nothing to add — disable
 * Stop Protection for good on a document that has no password at all.
 */
export function protectionHasPassword(element: OoxmlElement): boolean {
  return element.attributes.some(
    (attribute) =>
      attribute.namespaceUri === WML_NAMESPACE_URI &&
      PASSWORD_ATTRIBUTES.has(attribute.localName) &&
      attribute.value !== undefined &&
      attribute.value !== ''
  );
}

/** `@w:enforcement`: an optional `ST_OnOff` attribute, so absent is not enforced. */
function enforcementOf(element: OoxmlElement): boolean {
  const value = settingsAttributeValue(element, 'enforcement');
  if (value === undefined) return false;
  return value !== '0' && value !== 'false' && value !== 'off';
}

/** Read the protection state from a `settings.xml` root, or "not protected" when it has none. */
export function readDocumentProtection(
  settingsRoot: OoxmlNode | null | undefined
): DocumentProtectionState {
  if (!isSettingsElement(settingsRoot)) return NO_DOCUMENT_PROTECTION;
  const element = settingsChildNamed(settingsRoot, 'documentProtection');
  if (element === null) return NO_DOCUMENT_PROTECTION;
  const rawEdit = settingsAttributeValue(element, 'edit');
  const edit: DocumentProtectionEdit =
    rawEdit !== undefined && EDIT_VALUES.has(rawEdit)
      ? (rawEdit as DocumentProtectionEdit)
      : 'none';
  const password = protectionHasPassword(element);
  if (edit === 'none')
    return password ? { edit, enforced: false, password } : NO_DOCUMENT_PROTECTION;
  return { edit, enforced: enforcementOf(element), password };
}

/** Why tracked-changes protection refuses changing the author of a tracked change. */
export const TRACKED_CHANGES_AUTHOR_REASON =
  'this document is protected for tracked changes; their authors cannot change';
/** Why tracked-changes protection refuses accepting or rejecting a tracked change. */
export const TRACKED_CHANGES_DECISION_REASON =
  'this document is protected for tracked changes; changes cannot be accepted or rejected';

/**
 * What enforced tracked-changes protection refuses on existing tracked changes, or null.
 *
 * The protection lets a reviewer make tracked edits and comments only, so every change stays
 * pending and keeps the author who made it: a decision (`'decide'`) and a change of author
 * (`'attribute'`) are both refused. The editor's commands and the editing API share this rule.
 */
export function trackedChangesProtectionRefusal(
  protection: DocumentProtectionState,
  operation: 'decide' | 'attribute'
): string | null {
  if (!protection.enforced || protection.edit !== 'trackedChanges') return null;
  return operation === 'decide' ? TRACKED_CHANGES_DECISION_REASON : TRACKED_CHANGES_AUTHOR_REASON;
}
