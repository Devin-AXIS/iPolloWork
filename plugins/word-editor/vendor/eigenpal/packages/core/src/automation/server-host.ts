import { headlessViewOfStore } from '../store/headless-document-view.ts';
import { documentReads } from './reads.ts';
import {
  paginationContextFor,
  type AutomationPaginationProvider,
  type AutomationPaginationSnapshot,
} from './pagination.ts';
// The headless automation host.
//
// It owns what a browser session owns and nothing more: a package it opened through the
// bounded OPC/XML reader, one `TreePackageStore` over it, and the same `transact` write path
// the editor uses. There is no second model here — the store IS the document, exactly as in
// the browser, which is why the differential tests can compare the two hosts' canonical
// fingerprints rather than just their answers.
//
// UNTRUSTED BYTES. A `.docx` is a zip of XML an attacker controls end to end, so opening one
// goes through `readOoxmlPackage` — decompression-ratio and size caps, part/rel path
// validation, DTD/entity-free XML — and a refusal is a typed reason rather than a throw. This
// host performs no external fetch of any kind, and it has no HTML, DOM or CSS sink to feed:
// the only thing that leaves it is DOCX bytes from the normalizing serializer, and plain text
// and opaque handles through the protocol.
//
// PARAGRAPH IDENTITY is normalized at open, the same way the browser session normalizes it,
// so a document Word never gave `w14:paraId`s gets them once and both hosts hold the same
// canonical tree from revision zero. Skipping it here would make the two hosts' fingerprints
// differ on the first save of such a document, for no reason a consumer could see.

import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
  type OoxmlPackageLimits,
  type OoxmlPackageRejection,
} from '../store/package/ooxml-package.ts';
import { runWithTransactionActor } from '../store/package/actor-scoped-ids.ts';
import { ensureHyperlinkRelationship } from '../store/package/hyperlink-part.ts';
import { runObservedStoreTransaction } from '../store/package/canonical-primitive-capture.ts';
import { normalizeParagraphIdentity } from '../store/package/para-id.ts';
import type { ContentLockPolicy } from '../store/package/ooxml-edit.ts';
import { materializeGlossaryPlaceholders } from '../store/store/placeholder-materialize.ts';
import { refreshBoundContent } from '../store/store/bound-content-refresh.ts';
import { TreePackageStore, type StoryScope } from '../store/store/tree-package-store.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { ORIGIN_IDS } from '../store/registry/frozen-ids.ts';
import {
  type CollaborationModuleContribution,
  type EditorCollaborationSession,
} from '../collaboration/index.ts';
import { createCollaborationDocumentPort } from '../collaboration/replication.ts';
import { normalizeCollaborationTextPackage } from '../collaboration/document-port.ts';
import {
  addPackageComment,
  deletePackageComments,
  setPackageCommentResolved,
  setPackageCommentTexts,
} from '../store/store/comment-package-write.ts';
import { insertPackageCustomNode } from '../store/store/custom-node-package-write.ts';
import { settingsPartOf } from '../store/package/note-properties.ts';
import { readTrackingSettings } from '../store/package/tracking-settings.ts';
import { applyPackageUpdate, packageUpdateLanded } from '../store/store/tree-package-update.ts';
import {
  PACKAGE_UPDATE_REFUSALS,
  replaceDocumentError,
  type ReplaceDocumentRefusalLike,
} from './plan-replace-document.ts';
import type {
  AutomationCommentWriteResult,
  AutomationDocumentReplaceResult,
  AutomationDocumentPort,
  AutomationPortApplyResult,
  AutomationStagedOps,
} from './document-port.ts';
import { createAutomationHost } from './host.ts';
import type { AutomationCapabilities, AutomationHost } from './protocol.ts';

/** What a headless host can do. It paints nothing, so it claims nothing about painting. */
export const SERVER_AUTOMATION_CAPABILITIES: AutomationCapabilities = Object.freeze({
  document: true,
  save: true,
  events: true,
  selection: false,
  scrolling: false,
  layout: false,
});

/**
 * Why bytes could not be opened as a document: any bounded-reader rejection, plus the package
 * that parsed but carried no main document part.
 */
export type ServerAutomationHostRejection = OoxmlPackageRejection | 'no-main-document-part';

/**
 * A host over the opened bytes, or a refusal.
 *
 * A result rather than a throw: these bytes are untrusted input, and a malformed upload should
 * be a value the caller inspects rather than an exception from inside a zip decoder.
 */
export type ServerAutomationHostResult =
  | { readonly ok: true; readonly host: AutomationHost }
  | {
      readonly ok: false;
      readonly reason: ServerAutomationHostRejection;
      readonly limit?: 'zip.maxTotalBytes' | 'zip.maxRatio';
      readonly detail?: string;
    };

/**
 * How a headless host opens a document. Every field is optional.
 *
 * @public
 */
export interface ServerAutomationHostOptions {
  /** Optional real pagination for PAGE/NUMPAGES updates. */
  readonly pagination?: AutomationPaginationProvider;
  /**
   * Budgets for the bounded reader — archive size, part count, and XML elements.
   *
   * Omitted means the engine defaults. Lower budgets for untrusted input, or raise
   * `xml.maxElements` for larger documents when the host has sufficient memory.
   * Engine ceilings still apply.
   */
  readonly limits?: OoxmlPackageLimits;
  /**
   * Collaboration replica from the module registry. Absent, this host does
   * not attach a replica.
   */
  readonly collaborationModel?: CollaborationModuleContribution;
  /**
   * Document compare engine from the module registry (the review module's). Absent,
   * `compareFromBase64` refuses.
   */
  readonly compareDocuments?: import('../contracts/document-compare.ts').CompareDocumentsEngine;
  /**
   * Opt-in relaxation of `w:lock` for run-property writes (`setFont`): content-locked controls
   * can be restyled but not retyped. Absent, they refuse both.
   */
  readonly contentLockPolicy?: ContentLockPolicy;
}

const BODY: StoryScope = Object.freeze({ kind: 'body' as const });

/**
 * Open DOCX bytes into a headless automation host.
 *
 * A typed rejection rather than a throw: every failure here is a property of the FILE, and a
 * caller needs to tell "not a package" from "this package is hostile" from "no body".
 */
export function createServerAutomationHost(
  bytes: Uint8Array,
  options: ServerAutomationHostOptions = {}
): ServerAutomationHostResult {
  const opened = openPackageStore(bytes, options);
  if (!opened.ok) return opened;
  const { store } = opened;
  const collaboration = options.collaborationModel?.session;
  let detachCollaboration = (): void => {};
  const storePort = packageStorePort(store, collaboration, () => detachCollaboration(), options);
  const port: AutomationDocumentPort = options.compareDocuments
    ? { ...storePort, compareDocuments: options.compareDocuments }
    : storePort;
  if (options.pagination) {
    let snapshot: AutomationPaginationSnapshot | undefined;
    let atRevision = -1;
    const provider = options.pagination;
    port.prepare = async (request) => {
      if (!request.operations.some((operation) => operation.op === 'updateFieldResult')) return;
      snapshot = undefined;
      const revision = store.packageRevision;
      const prepared = await provider(headlessViewOfStore(store));
      if (store.packageRevision === revision) {
        snapshot = prepared;
        atRevision = revision;
      }
    };
    port.fieldPageContext = (story, paragraphId, fieldNodeId) => {
      if (store.packageRevision !== atRevision) return null;
      const reads = documentReads(store.currentPackage()).story(story);
      return reads ? paginationContextFor(snapshot, reads.part, paragraphId, fieldNodeId) : null;
    };
  }

  const host = createAutomationHost({
    port,
    capabilities: SERVER_AUTOMATION_CAPABILITIES,
  });
  if (collaboration) {
    detachCollaboration = collaboration.attach(
      createCollaborationDocumentPort(store, {
        documentId: collaboration.documentId,
      })
    );
  }
  return {
    ok: true,
    host,
  };
}

/**
 * Open bytes into a store the way this host opens its document: the bounded reader, bound
 * content refreshed, paragraph identity normalized, and glossary placeholders shown. A
 * replacement opens the same way, so it differs from the open document only where the file does.
 */
function openPackageStore(
  bytes: Uint8Array,
  options: Pick<ServerAutomationHostOptions, 'limits' | 'contentLockPolicy'>
):
  | { readonly ok: true; readonly store: TreePackageStore }
  | Extract<ServerAutomationHostResult, { readonly ok: false }> {
  const loaded = readOoxmlPackage(bytes, options.limits ?? {});
  if (!loaded.ok) {
    return {
      ok: false,
      reason: loaded.reason,
      ...(loaded.limit === undefined ? {} : { limit: loaded.limit }),
      ...(loaded.detail ? { detail: loaded.detail } : {}),
    };
  }
  // Bound controls show their store's current value, not the text cached at save.
  const pkg = refreshBoundContent(loaded.package);
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) {
    return {
      ok: false,
      reason: 'no-main-document-part',
      detail: pkg.mainDocumentPart,
    };
  }
  const store = new TreePackageStore(
    pkg,
    materializeGlossaryPlaceholders(pkg, normalizeParagraphIdentity(main)),
    options.contentLockPolicy ? { contentLockPolicy: options.contentLockPolicy } : {}
  );
  return { ok: true, store };
}

/**
 * Replace the store's document with `docx` as one package update, with the editor command's
 * refusals. The headless twin of the editor's `replaceDocument`: no viewing or suggesting mode
 * exists here, but enforced protection and the collaboration room refuse the same way.
 */
function replaceStoreDocument(
  store: TreePackageStore,
  docx: Uint8Array,
  collaboration: EditorCollaborationSession | undefined,
  options: Pick<ServerAutomationHostOptions, 'limits' | 'contentLockPolicy'>
): AutomationDocumentReplaceResult {
  const refused = (refusal: ReplaceDocumentRefusalLike): AutomationDocumentReplaceResult => ({
    ok: false,
    error: replaceDocumentError(refusal),
  });
  const settings = readTrackingSettings(settingsPartOf(store.currentPackage())?.root);
  if (
    settings.restrictedToComments ||
    settings.restrictedToForms ||
    settings.restrictedToTrackedChanges ||
    settings.restrictedToReadOnly
  )
    return refused({
      code: 'editNotPermitted',
      reason: 'protected',
      message: 'Document protection does not permit an untracked edit.',
    });
  const gate = collaboration?.gateOperations([], BODY);
  if (gate)
    return refused({
      code: 'unavailable',
      reason: 'collaborationUnavailable',
      message: `The collaboration session cannot accept edits now (${gate}).`,
    });
  const opened = openPackageStore(docx, options);
  if (!opened.ok)
    return refused({ code: 'invalidDocument', message: 'The bytes are not a valid DOCX file.' });
  const incoming = opened.store.currentPackage();
  const result = runWithTransactionActor(collaboration?.identity.actorId, () =>
    applyPackageUpdate(store, incoming)
  );
  if (!result.ok)
    return refused({
      code: 'editUnsupported',
      reason: PACKAGE_UPDATE_REFUSALS[result.reason],
      message: `The file cannot apply as an edit (${result.reason}).`,
    });
  if (!result.change) return { ok: true, changed: false };
  // Shared state is the authority. A room that refused the edit realigned this replica.
  collaboration?.flushPendingJournals();
  if (collaboration && !packageUpdateLanded(store.currentPackage(), incoming))
    return refused({
      code: 'editUnsupported',
      reason: 'collaborationRefused',
      message: 'The collaboration session refused the edit. The document keeps the shared content.',
    });
  return { ok: true, changed: true };
}

/**
 * The relationship id for an external hyperlink target on the addressed story's part, or null.
 *
 * The shell, not a story transaction: the relationship lives beside the trees, and the store keeps it
 * across lifecycle snapshots so an undo cannot orphan the `r:id` a committed link names. An
 * unreferenced hyperlink relationship is inert markup Word writes too, so this order — relationship
 * first, then the op that names it — is the engine's own; the reverse would publish a link pointing
 * at an id nothing declares.
 */
function mintExternalTarget(
  store: TreePackageStore,
  url: string,
  scope: StoryScope
): string | null {
  const owner = store.partFor(scope);
  if (!owner) return null;
  // Armed like the browser session's own mint: a shell write records no primitive effects on
  // its own, so a server-side `insertHyperlink` used to publish an rId the peers never
  // received a relationship for.
  return runObservedStoreTransaction(
    store,
    () => {
      const minted = ensureHyperlinkRelationship(store.currentPackage(), url, owner.name);
      if (!minted) return null;
      store.replacePackageShell(minted.pkg);
      return minted.relationshipId;
    },
    (relationshipId) => relationshipId !== null
  );
}

/**
 * The port over a store this host owns.
 *
 * `apply` is one `transact` call for the whole batch — that is where atomicity comes from,
 * not from anything the host layer does: the store stages ops against a working package and
 * publishes nothing until every one of them has been accepted.
 *
 * Exported so tests can reach `applyLifecycle` without going through the protocol planner,
 * which has no furniture-create command.
 *
 * @internal
 */
export function packageStorePort(
  store: TreePackageStore,
  collaboration?: EditorCollaborationSession,
  detachCollaboration: () => void = () => {},
  openOptions: Pick<ServerAutomationHostOptions, 'limits' | 'contentLockPolicy'> = {}
): AutomationDocumentPort {
  let live = true;
  let operationCounter = 0;
  const mutationOptions = () => {
    if (!collaboration) return {};
    operationCounter += 1;
    return {
      origin:
        collaboration.identity.role === 'agent'
          ? ORIGIN_IDS.mutationAgent
          : ORIGIN_IDS.mutationHuman,
      actorId: collaboration.identity.actorId,
      operationId: `${collaboration.identity.actorId}:${collaboration.sessionId}:automation:${operationCounter}`,
      recordsHistory: false,
    };
  };
  // Publication now happens on the commit itself, so this drain finds nothing to do. It stays as
  // the seam that makes that a fact rather than an assumption: every mutating return goes through
  // here, so a method added later cannot start replicating late. What it used to fix — a script
  // that awaited `sync()` and read a peer that had not received the edit — is structurally gone.
  const published = <T>(result: T): T => {
    collaboration?.flushPendingJournals();
    return result;
  };
  return {
    localChangeTracking: true,
    collaborative: () => !!collaboration,
    allocationActor: () => collaboration?.identity.actorId,
    revision: () => store.packageRevision,
    currentPackage: (): OoxmlPackage | null => (live ? store.currentPackage() : null),
    apply(
      staged: AutomationStagedOps,
      scope: StoryScope = BODY,
      packageEdits = []
    ): AutomationPortApplyResult {
      if (!live) return { ok: false, reason: 'disposed' };
      // BUILT HERE, not by the planner: minting the relationship an external link names changes the
      // package, and this host has no mode to refuse a write, so "here" is as late as it gets — a
      // batch that was refused while planning has already left without touching anything.
      // Bound to the collaboration actor: the mint lands on the package shell before the
      // transaction below, so nothing else binds one, and two hosts minting at the same moment
      // would both take `rId${max + 1}` for different targets.
      const ops = staged((url) =>
        runWithTransactionActor(collaboration?.identity.actorId, () =>
          mintExternalTarget(store, url, scope)
        )
      );
      if (ops === null) return { ok: false, reason: 'unsupported-target' };
      const collaborationRefusal = collaboration?.gateOperations(ops, scope);
      if (collaborationRefusal) return { ok: false, reason: collaborationRefusal };
      const partName = collaboration ? store.partFor(scope)?.name : undefined;
      const result = store.transact(
        scope,
        (ctx) => {
          for (const edit of packageEdits) ctx.applyPackage(edit);
          for (const op of ops) ctx.apply(op);
          if (partName) {
            ctx.applyPackage((pkg) => normalizeCollaborationTextPackage(pkg, partName, ops));
          }
        },
        mutationOptions()
      );
      if (!result.ok) {
        return {
          ok: false,
          reason: result.detail ? `${result.reason}: ${result.detail}` : result.reason,
        };
      }
      return published({ ok: true, changed: result.change !== null });
    },
    applyLifecycle(op: TreeDocOp): AutomationPortApplyResult {
      if (!live) return { ok: false, reason: 'disposed' };
      const collaborationRefusal = collaboration?.gateOperations([op], BODY);
      if (collaborationRefusal) return { ok: false, reason: collaborationRefusal };
      // The store's own package transaction: parts, relationships, content types and settings
      // restored together on undo. Routed here rather than through `transact` because a story
      // transaction cannot carry a part it does not own.
      // Bound to the collaboration actor: furniture and note lifecycle mint `rId`s on the
      // package shell, and this path does not go through `transact`. The browser twin wraps
      // the same op class in `commitSessionTreeOps`.
      const result = runWithTransactionActor(collaboration?.identity.actorId, () =>
        store.applyLifecycleOp(op)
      );
      if (!result.ok) {
        return {
          ok: false,
          reason: result.detail ? `${result.reason}: ${result.detail}` : result.reason,
        };
      }
      return published({ ok: true, changed: result.change !== null });
    },
    applyCommentWrites(writes, scope): AutomationCommentWriteResult {
      if (!live) return { ok: false, reason: 'disposed' };
      if (writes.length === 0) return { ok: true, changed: false };
      // The same readiness gate `apply` and `applyLifecycle` ask. Comment writes carry no
      // tree ops of their own, so the gate sees an empty batch — its readiness and
      // attachment ladder still answers, which is what this port was skipping.
      const collaborationRefusal = collaboration?.gateOperations([], scope);
      if (collaborationRefusal) return { ok: false, reason: collaborationRefusal };
      const story = store.resolveStory(scope);
      if (!story.ok) return { ok: false, reason: story.reason };
      // The story store keeps a package of its own, and the coordinator's copy carries writes the
      // story store has not seen — a minted hyperlink relationship, a numbering graft. Grafting
      // before and republishing after is the same order the editor's own comment path uses; skip
      // either half and one write silently overwrites the other's parts.
      story.store.graftPackage(() => store.currentPackage());
      if (writes.every((write) => write.kind === 'delete')) {
        // Through the coordinator, so the deletion enters an observed transaction and journals.
        // Deleting in the story store and swapping the shell records no effects: the peer kept
        // both the markers and the comment, and the two documents disagreed with nothing to
        // reconcile from. One `noteId` for the batch, the same collapse the browser host makes.
        const first = writes.find((write) => write.kind === 'delete');
        const changed = runWithTransactionActor(collaboration?.identity.actorId, () =>
          deletePackageComments(
            store,
            writes.flatMap((write) =>
              write.kind === 'delete'
                ? [
                    {
                      commentId: write.commentId,
                      ...(write.parentCommentId === undefined
                        ? {}
                        : { parentCommentId: write.parentCommentId }),
                    },
                  ]
                : []
            ),
            scope,
            first?.kind === 'delete' ? first.noteId : undefined
          )
        );
        if (!changed) return { ok: false, reason: 'comment-delete-refused' };
        return published({ ok: true, changed });
      }
      if (writes.every((write) => write.kind === 'edit')) {
        const edited = runWithTransactionActor(collaboration?.identity.actorId, () =>
          setPackageCommentTexts(
            store,
            writes.map((write) => ({ commentId: write.commentId, text: write.text }))
          )
        );
        return edited.ok
          ? published({ ok: true, changed: edited.changed })
          : { ok: false, reason: edited.reason };
      }
      if (writes.length !== 1) return { ok: false, reason: 'mixed-comment-writes' };
      const write = writes[0]!;
      // Through the package coordinator for create and reply, so the write enters an observed
      // transaction and a replica sees `comments.xml`, its relationship and its content-type
      // override — not just the markers in the story. This is the same path the editor's own
      // comment lane takes, which is what keeps the two hosts from drifting.
      if (write.kind === 'create' || write.kind === 'reply') {
        const added = runWithTransactionActor(collaboration?.identity.actorId, () =>
          addPackageComment(
            store,
            {
              anchor: write.anchor,
              author: write.author,
              text: write.text,
              ...(write.date === undefined ? {} : { date: write.date }),
              ...(write.kind === 'reply' ? { replyToCommentId: write.parentCommentId } : {}),
            },
            scope
          )
        );
        if (!added.ok) return { ok: false, reason: added.reason };
        return published({
          ok: true,
          changed: true,
          ...('commentId' in added ? { commentId: added.commentId } : {}),
        });
      }
      if (write.kind !== 'resolve') return { ok: false, reason: 'unsupported-comment-write' };
      // Also through the coordinator: `@w15:done` lives in `commentsExtended.xml`, which a thread
      // with no reply does not have yet. Capture has to be armed for that create-part, or the peer
      // keeps reading the thread as open.
      const resolved = runWithTransactionActor(collaboration?.identity.actorId, () =>
        setPackageCommentResolved(store, write.commentId, write.resolved)
      );
      if (!resolved.ok) return { ok: false, reason: resolved.reason };
      // No `commentId`: resolving names a comment the caller already holds.
      return published({ ok: true, changed: true });
    },
    applyCustomNodeWrite(write, scope): AutomationPortApplyResult {
      if (!live) return { ok: false, reason: 'disposed' };
      // Same readiness gate as `applyCommentWrites`: the write is not op-shaped, so the
      // gate judges only readiness, attachment, and scope.
      const collaborationRefusal = collaboration?.gateOperations([], scope);
      if (collaborationRefusal) return { ok: false, reason: collaborationRefusal };
      const story = store.resolveStory(scope);
      if (!story.ok) return { ok: false, reason: story.reason };
      // Through the coordinator, which grafts, runs an observed transaction, replaces the shell and
      // publishes. Writing into the story store and swapping the shell recorded no effects, so a
      // peer received neither the data part nor the `w:sdt` bound to it. The actor wrap covers the
      // `rId` and content-control id this mints; the helper takes no actor of its own.
      const result = runWithTransactionActor(collaboration?.identity.actorId, () =>
        insertPackageCustomNode(store, write, scope)
      );
      if (!result.ok) {
        return {
          ok: false,
          reason: result.detail ? `${result.reason}: ${result.detail}` : result.reason,
        };
      }
      return published({ ok: true, changed: result.change !== null });
    },
    replaceDocument(docx) {
      if (!live)
        return {
          ok: false,
          error: replaceDocumentError({ code: 'unavailable', message: 'This host was disposed.' }),
        };
      return replaceStoreDocument(store, docx, collaboration, openOptions);
    },
    save: () => (live ? writeOoxmlPackage(store.currentPackage()) : null),
    subscribe: (listener) => store.subscribe(() => listener()),
    dispose() {
      detachCollaboration();
      live = false;
    },
  };
}
