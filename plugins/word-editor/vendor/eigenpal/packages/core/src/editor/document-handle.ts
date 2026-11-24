// `getDocumentHandle()`: the loaded document's identity and revision.

import type { DocumentHandle } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/**
 * One id per opened session. Every `load()` opens a new session, so a reload (a document
 * refresh in reload mode included) gets a new id, while an edit, an undo, or a move to another
 * window keeps it. Keyed by the session object, so nothing holds a closed one.
 */
const loadIds = new WeakMap<object, string>();
let nextLoadId = 0;

function loadIdOf(session: object): string {
  let id = loadIds.get(session);
  if (id === undefined) {
    id = `load-${(++nextLoadId).toString(36)}`;
    loadIds.set(session, id);
  }
  return id;
}

/** The handle of the document on `surface`. With no document mounted, an empty `loadId`. */
export function documentHandleOf(surface: PaginatedSurface | null): DocumentHandle {
  // Package revision: the body's own stands still for header/footer/note work.
  return Object.freeze({
    revision: surface?.session.packageRevision() ?? 0,
    loadId: surface ? loadIdOf(surface.session) : '',
  });
}

/** Why `expected` no longer describes the document on `surface`, or null when it still does. */
export function handleMismatch(
  expected: DocumentHandle,
  surface: PaginatedSurface
): 'otherDocument' | 'edited' | null {
  const current = documentHandleOf(surface);
  if (expected.loadId !== current.loadId) return 'otherDocument';
  return expected.revision === current.revision ? null : 'edited';
}
