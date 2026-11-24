// The types `openTreeSession` takes and returns, kept out of tree-session.ts so that file stays
// under its max-lines cap. Re-exported from tree-session.ts, so every existing import through
// that module stays stable.

import type { Node as PMNode } from 'prosemirror-model';
import type { OoxmlPackageRejection, OoxmlPackageResult } from '@docx-editor.dev/core/store';
import type { ReviewModuleContribution } from '../contracts/modules.ts';
import type { ContentLockPolicy } from '../store/package/ooxml-edit.ts';
import type { TreeApplyResult, TreeDocxSessionView } from './tree-session-contract.ts';

/** How `openTreeSession` opens a package. */
export interface OpenTreeSessionOptions {
  /**
   * The review module's derivation hooks, contributed through the editor's
   * `EditorModule` seam. Absent — the free engine — the session's
   * `reviewItems()` reports the typed empty queue; parse, preservation, and
   * `hasReviewContent` are unaffected.
   */
  readonly reviewModel?: ReviewModuleContribution;
  /**
   * Opt-in relaxation of `w:lock` for run formatting: `contentLocked` / `sdtContentLocked`
   * controls can be restyled (bold, color, font …) but not retyped. Absent, they refuse both.
   * See {@link ContentLockPolicy}.
   */
  readonly contentLockPolicy?: ContentLockPolicy;
}

/**
 * Why bytes could not be opened: any bounded-reader rejection, plus the package that parsed but
 * carried no main document tree.
 */
export type TreeSessionRejection = OoxmlPackageRejection | 'no-main-document-tree';

/**
 * An open session, or a typed refusal.
 *
 * A result rather than a throw: every failure here is a property of the FILE, and a host needs to
 * tell "this is not a package" from "this package is malicious" from "this document has no body".
 */
export type OpenTreeSessionResult =
  | { readonly ok: true; readonly session: TreeDocxSession }
  | Extract<OoxmlPackageResult, { readonly ok: false }>
  | { readonly ok: false; readonly reason: 'no-main-document-tree'; readonly detail?: string };

/**
 * Binding-only session methods that exchange ProseMirror projections.
 *
 * Editor surfaces expose {@link TreeDocxSessionView}. Only the binding lane sees this extension.
 */
export interface TreeDocxSession extends TreeDocxSessionView {
  /** Project the current BODY revision into a ProseMirror doc. */
  projectDoc(): PMNode;
  /** Re-project incrementally from the last committed change, reusing untouched paragraphs. */
  reconcile(previousDoc: PMNode): PMNode;
  /**
   * Whether the last commit changed the BLOCK SEQUENCE (a split, join, insert or delete).
   *
   * A host needs this to decide whether the view must be re-projected at all. After a pure
   * text edit, the view already holds what the model holds. Re-projecting wastes work and
   * races the next keystroke.
   */
  lastCommitWasStructural(): boolean;
  /** Map an edited BODY doc to tree ops and commit them as one transaction. */
  applyPmDoc(doc: PMNode): TreeApplyResult;
}
