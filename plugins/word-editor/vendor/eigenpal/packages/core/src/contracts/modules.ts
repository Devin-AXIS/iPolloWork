import type { CompareDocumentsDialogSession } from './compare-documents.ts';
import type {
  CompareDocumentsBackgroundEngine,
  CompareDocumentsEngine,
} from './document-compare.ts';
export type {
  CompareDocumentsBackgroundEngine,
  CompareDocumentsBackgroundResult,
  CompareDocumentsEngine,
  CompareDocumentsEngineErrorCode,
  CompareDocumentsErrorCode,
  CompareDocumentsRefusalReason,
  CompareDocumentsEngineOptions,
  CompareDocumentsEngineResult,
  CompareDocumentsPhase,
  CompareDocumentsProgress,
} from './document-compare.ts';
import type { RevisionMarkupDialogSession } from './revision-markup.ts';
import type { ReviewPaneOptions } from './review-pane.ts';
import type { EditorDiagnostic, EditorDiagnosticKind } from './diagnostics.ts';
/**
 * `@docx-editor.dev/core/contracts/modules` — the `EditorModule` seam.
 *
 * How a paid or optional capability contributes to the engine without the free tier importing
 * it: the review module and custom nodes both arrive through here, and their absence leaves the
 * corresponding chrome disabled with the engine's own reason.
 *
 * NOT a plugin system. The shape is closed: every contribution point is named
 * here, core iterates registered modules at its existing dispatch points, and
 * core never imports a capability package. A capability absent from this file
 * is not extendable from outside — deliberately, so the one-pipeline principle
 * survives the packaging boundary.
 * The free engine behaves identically with an empty registry: documents
 * round-trip losslessly, revisions render in their final-state projection, and
 * the review chrome slots stay disabled with the engine's own reason.
 *
 * @packageDocumentation
 * @public
 */

import type { OoxmlPart } from '@docx-editor.dev/core/store';
import type { CollaborationModuleContribution } from '../collaboration/index.ts';
import type { ReviewDisplayMode } from '../layout/revision-projection.ts';
import type {
  ReviewItem,
  ReviewModelInput,
  ReviewRevisionItem,
} from '../store/store/review-items.ts';

// `ReviewModuleContribution` hands all four of these to an implementor, so this entry point —
// the one a capability package is written against — has to let it name them. Re-exported here
// rather than left in `layout/` and `store/` for the same reason the editor contract re-exports
// its review vocabulary: a module author is not importing those lanes.
export type { ReviewModelInput };
export type { CommentRecord } from '../store/store/comment-reads.ts';
export type {
  ReviewCommentItem,
  ReviewCustomItem,
  ReviewItem,
  ReviewRange,
  ReviewPosition,
  ReviewRevisionItem,
  ReviewRevisionKind,
} from '../store/store/review-items.ts';
// `OoxmlPart` is the argument `revisionItemsOfParagraph` takes, so it belongs here. The rest of
// the canonical tree deliberately does NOT: re-exporting `OoxmlElement` pulls its ~85-member
// node union onto this entry point, which would make the module seam the second published
// definition of the document model. A module author reaches the tree at
// `@docx-editor.dev/core/store`, which is a published subpath written for exactly that.
export type { OoxmlPart, RevisionAddress } from '@docx-editor.dev/core/store';
// The compare engine takes and returns the original as a package, and the dialog contribution
// receives a session, so a module author can type both.
export type {
  ContentTypeIndex,
  OoxmlExternalTarget,
  OoxmlPackage,
  RelationshipRecord,
  TargetMode,
} from '@docx-editor.dev/core/store';
export type {
  CompareDocumentsDialogSession,
  CompareDocumentsOutcome,
  CompareDocumentsRequest,
} from './compare-documents.ts';
export type { ReviewDisplayMode, RevisionDisplayMode } from '../layout/revision-projection.ts';

/**
 * Derives the review queue — every pending revision decision and comment
 * thread — from one story part plus its comment parts. Implemented by the pro
 * review module; the free engine has no implementation and reports an empty
 * queue.
 *
 * @public
 */
export type CollectReviewItems = (input: ReviewModelInput) => readonly ReviewItem[];

/** Viewer settings dialog supplied by the review module. @public */
export interface RevisionMarkupDialog {
  open(): void;
  destroy(): void;
}

/** Local settings access for review chrome. No document mutations occur here. @public */
export interface RevisionMarkupDialogHost extends RevisionMarkupDialogSession {
  readonly container: HTMLElement;
  readonly translate?: (key: string) => string | undefined;
}

/** Compare documents dialog supplied by the review module. @public */
export interface CompareDocumentsDialog {
  open(): void;
  destroy(): void;
}

/** What the Compare documents dialog may use: its session, mount, and strings. @public */
export interface CompareDocumentsDialogHost extends CompareDocumentsDialogSession {
  readonly container: HTMLElement;
  readonly translate?: (key: string) => string | undefined;
}

/**
 * What a review module contributes: the queue derivation, and the revision
 * display modes the editor may enter beyond the free tier's final-state
 * projection.
 *
 * @public
 */
export interface ReviewModuleContribution {
  /** Document compare. Absent, compare commands refuse. */
  readonly compareDocuments?: CompareDocumentsEngine;
  /**
   * The same compare off the main thread. When present, the Compare documents dialog uses it,
   * reports progress, and can stop a running compare. If it rejects before its first progress
   * report, the dialog compares with `compareDocuments` instead. The `compareDocuments` command
   * stays synchronous and uses `compareDocuments`.
   */
  readonly compareDocumentsInBackground?: CompareDocumentsBackgroundEngine;
  /** Create the Compare documents dialog when a host opens it. */
  readonly createCompareDocumentsDialog?: (
    host: CompareDocumentsDialogHost
  ) => CompareDocumentsDialog;
  /** Create local review settings chrome when a host opens the dialog. */
  readonly createRevisionMarkupDialog?: (host: RevisionMarkupDialogHost) => RevisionMarkupDialog;
  /**
   * Display modes this module unlocks (the free engine renders `proposed` only).
   *
   * The module enables the listed review projections.
   */
  readonly displayModes: readonly ReviewDisplayMode[];
  /**
   * The review pane settings the editor starts with. `setReviewPaneOptions` changes them later.
   */
  readonly pane?: ReviewPaneOptions;
  /** The review queue derivation. */
  readonly collectReviewItems: CollectReviewItems;
  /**
   * Revisions wholly inside one paragraph — for the conservative local review
   * patch after a text-local body edit.
   */
  readonly revisionItemsOfParagraph: (
    part: OoxmlPart,
    paragraphId: string
  ) => readonly ReviewRevisionItem[];
}

/**
 * The replica the surface attaches. The host passes a ready session.
 *
 * @public
 */
export type { CollaborationModuleContribution };

/**
 * One registered capability module. Registration is construction-time
 * (`createDocxEditor({ modules })`) and immutable for the instance's lifetime.
 *
 * @public
 */
export interface EditorModule {
  /** Diagnostic identity (`'review'`, `'custom-nodes'`); not a dispatch key. */
  readonly id: string;
  /** Review capability: queue derivation, commands gate, display modes. */
  readonly review?: ReviewModuleContribution;
  /**
   * Collaboration replica. Absent, the editor stays single-user: local undo
   * stays the authority, and `snapshot().collaborationStatus` is `'inactive'`.
   */
  readonly collaboration?: CollaborationModuleContribution;
  /**
   * Custom inline node definitions. Reserved: the definition shape lands with
   * the custom-nodes lane; the registry carries them opaquely until then.
   */
  readonly customNodes?: readonly unknown[];
  /**
   * customXml payload namespaces this module OWNS, swept for orphans when a document opens.
   *
   * A payload lives in a customXml data part, and Word will not delete one when a user deletes
   * the control bound to it — nothing in OOXML asks it to. So a document can arrive holding
   * payloads for chips that no longer exist, and reconciling against what the story actually
   * binds is the only thing that collects them.
   *
   * The claim is what keeps the sweep off other people's stores: Word's own Cover Page
   * Properties store rides in most templates, and a sweep that walked every customXml part
   * would be deleting from it on the strength of a name collision. A namespace no module names
   * is never touched.
   */
  readonly customNodePayloadNamespaces?: readonly string[];
  /**
   * Told when the recognition pass finds something wrong with a node in THIS editor's document.
   *
   * Carried per module rather than kept by the capability package, so two editors on one page
   * hear only their own documents and a detached editor's listener goes with it. The shape is
   * opaque here for the same reason `customNodes` is: what a diagnostic means belongs to the
   * package that raised it.
   */
  readonly onCustomNodeDiagnostic?: (diagnostic: unknown) => void;
  /**
   * Told about every anonymous diagnostic of this editor, from its first open on.
   *
   * The same events as `editor.on('diagnostic')`, but registered before the editor exists, so
   * a document passed at construction is observed too. A listener that throws is ignored: an
   * observer must never break the editor it observes.
   */
  readonly onDiagnostic?: (event: EditorDiagnostic) => void;
  /**
   * Whether `onDiagnostic` wants events of `kind` now. Absent, it wants every kind. The editor
   * asks before work that only a diagnostic needs, such as timing key presses for
   * `performance`, and skips that work when no listener wants it. Read often: keep it cheap.
   */
  readonly wantsDiagnostic?: (kind: EditorDiagnosticKind) => boolean;
}

/**
 * The resolved registry the editor instance holds: at most one review
 * contribution and at most one collaboration contribution (first registration
 * wins for each), all custom node definitions in registration order.
 */
export interface EditorModuleRegistry {
  readonly review: ReviewModuleContribution | null;
  readonly collaboration: CollaborationModuleContribution | null;
  readonly customNodes: readonly unknown[];
  /** Every claimed payload namespace, deduplicated, in registration order. */
  readonly customNodePayloadNamespaces: readonly string[];
  /** Every registered diagnostic listener, in registration order. */
  readonly customNodeDiagnostics: readonly ((diagnostic: unknown) => void)[];
  /** Every registered `onDiagnostic` listener, in registration order. */
  readonly diagnosticListeners: readonly ((event: EditorDiagnostic) => void)[];
  /** Whether any module with `onDiagnostic` wants events of `kind` now. */
  readonly wantsDiagnostic: (kind: EditorDiagnosticKind) => boolean;
}

const EMPTY_REGISTRY: EditorModuleRegistry = Object.freeze({
  review: null,
  collaboration: null,
  customNodes: Object.freeze([]) as readonly unknown[],
  customNodePayloadNamespaces: Object.freeze([]) as readonly string[],
  customNodeDiagnostics: Object.freeze([]) as readonly ((diagnostic: unknown) => void)[],
  diagnosticListeners: Object.freeze([]) as readonly ((event: EditorDiagnostic) => void)[],
  wantsDiagnostic: () => false,
});

/** Resolve construction-time modules into the registry the instance dispatches over. */
export function resolveEditorModules(
  modules: readonly EditorModule[] | undefined
): EditorModuleRegistry {
  if (!modules || modules.length === 0) return EMPTY_REGISTRY;
  let review: ReviewModuleContribution | null = null;
  let collaboration: CollaborationModuleContribution | null = null;
  const customNodes: unknown[] = [];
  const namespaces = new Set<string>();
  const diagnostics: ((diagnostic: unknown) => void)[] = [];
  const diagnosticListeners: ((event: EditorDiagnostic) => void)[] = [];
  const wants: ((kind: EditorDiagnosticKind) => boolean)[] = [];
  for (const module of modules) {
    // First registration wins: two review modules is a configuration mistake,
    // and silently merging them would leave neither author able to say which
    // derivation runs. The second is ignored rather than throwing — a module
    // list assembled from independent sources must not take the editor down.
    if (module.review && review === null) review = module.review;
    // Same rule as review: two collaboration modules is a configuration
    // mistake, and silently merging two sessions would leave neither author
    // able to say which replica attaches. The second is ignored rather than
    // throwing — a module list assembled from independent sources must not
    // take the editor down.
    if (module.collaboration && collaboration === null) {
      collaboration = module.collaboration;
    }
    if (module.customNodes) customNodes.push(...module.customNodes);
    for (const namespace of module.customNodePayloadNamespaces ?? []) namespaces.add(namespace);
    if (module.onCustomNodeDiagnostic) diagnostics.push(module.onCustomNodeDiagnostic);
    if (module.onDiagnostic) {
      diagnosticListeners.push(module.onDiagnostic);
      wants.push(module.wantsDiagnostic ?? (() => true));
    }
  }
  return {
    review,
    collaboration,
    customNodes,
    customNodePayloadNamespaces: [...namespaces],
    customNodeDiagnostics: diagnostics,
    diagnosticListeners,
    // A module that throws is asked again next time; an observer never breaks the editor.
    wantsDiagnostic: (kind) =>
      wants.some((want) => {
        try {
          return want(kind) === true;
        } catch {
          return false;
        }
      }),
  };
}
