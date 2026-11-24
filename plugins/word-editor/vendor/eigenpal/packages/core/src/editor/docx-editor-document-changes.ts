// The facade's `documentChange` events, from one mounted session's commits.

import type { DocumentChange, ParagraphsChangeEvent } from '@docx-editor.dev/core/contracts/editor';
import type { PaginatedSurface } from './paginated-surface.ts';
import { createParagraphChangeTracker } from './paragraph-changes.ts';
import { refreshEditActive } from './refresh-edit-source.ts';

export interface DocumentChangeHooks {
  /** A commit can move a page-fit zoom's numerator. */
  refitIfPageResized(): void;
  /** Move the snapshot version. */
  bump(): void;
  emit(change: DocumentChange): void;
  /** Whether anything listens to `paragraphsChange`, so a commit nobody reads costs nothing. */
  wantsParagraphs(): boolean;
  emitParagraphs(event: ParagraphsChangeEvent, isCurrent: () => boolean): void;
  /** Queue one commit's notifications before a host listener can make another edit. */
  defer<T>(run: () => T): T;
}

const localEdits = new WeakMap<PaginatedSurface, number>();

/**
 * When this user last changed the document on `surface` (`performance.now()`), or `-Infinity`.
 * Commits from other collaboration participants do not count.
 */
export function localEditAt(surface: PaginatedSurface | null | undefined): number {
  return (surface && localEdits.get(surface)) ?? -Infinity;
}

/** Report every commit of `surface`'s session as a `documentChange`. Returns the unsubscribe. */
export function subscribeDocumentChanges(
  surface: PaginatedSurface,
  hooks: DocumentChangeHooks
): () => void {
  // Created with the subscription, so it starts from the revision this session mounted.
  const paragraphs = createParagraphChangeTracker(
    surface.session,
    () => surface.collaborationSession()?.identity.actorId
  );
  let active = true;
  const unsubscribe = surface.session.subscribe((change) => {
    // Another participant's commit is not this user typing: it never holds late fonts back.
    const actor = surface.collaborationSession()?.identity.actorId;
    if (!change.actorId || change.actorId === actor) localEdits.set(surface, performance.now());
    const documentChange: DocumentChange = {
      // The PACKAGE revision, never `change.toRevision`: a header/footer or notes change
      // carries THAT part's counter, which starts at zero, so reporting it sent this
      // number backwards and then repeated values it had already emitted.
      revision: surface.session.packageRevision(),
      created: change.created,
      deleted: change.deleted,
      dirty: change.dirty,
      // An undoable document update is the processor's result, not a user edit.
      ...(refreshEditActive(surface.session) ? { source: 'refresh' as const } : {}),
    };
    hooks.defer(() => {
      // Capture this commit before host code can edit the document again.
      const event = paragraphs.note(change, documentChange.revision, hooks.wantsParagraphs());
      // A commit can move a fit's numerator: `setPageSetup` directly, and undo by both of its
      // routes (the keymap's `surface.undo()` and `exec`), neither of which passes a command
      // hook. Guarded on the authored page width. Reading that width enumerates the sections,
      // and a text-local change edits only run content, never a `w:sectPr`, so a keystroke
      // skips it. Refitting can notify selection listeners, so defer those callbacks too.
      if (change.impact !== 'text-local') hooks.refitIfPageResized();
      // Bump BEFORE dispatch, so a handler reading `snapshot()` sees the new state.
      hooks.bump();
      hooks.emit(documentChange);
      // Queue both notifications together so listener edits follow this commit's event.
      if (event) hooks.emitParagraphs(event, () => active);
    });
  });
  return () => {
    active = false;
    unsubscribe();
  };
}
