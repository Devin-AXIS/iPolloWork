// Late fonts wait for a pause in THIS user's editing. A commit from another collaboration
// participant is not this user typing, so it never holds an install back.

import { expect, test } from 'bun:test';
import type { PaginatedSurface } from '../paginated-surface.ts';
import { localEditAt, subscribeDocumentChanges } from '../docx-editor-document-changes.ts';

function fakeSurface(actorId: string | undefined) {
  let commit: ((change: object) => void) | undefined;
  const surface = {
    session: {
      subscribe: (run: (change: object) => void) => ((commit = run), () => {}),
      currentPackage: () => ({}),
      packageRevision: () => 1,
    },
    collaborationSession: () => (actorId ? { identity: { actorId } } : null),
  } as unknown as PaginatedSurface;
  subscribeDocumentChanges(surface, {
    refitIfPageResized: () => {},
    bump: () => {},
    emit: () => {},
    wantsParagraphs: () => false,
    emitParagraphs: () => {},
    defer: (run) => run(),
  });
  const change = (actor?: string) =>
    commit!({ dirty: [], created: [], deleted: [], ...(actor ? { actorId: actor } : {}) });
  return { surface, change };
}

test('a local commit records the edit time', () => {
  const { surface, change } = fakeSurface(undefined);
  expect(localEditAt(surface)).toBe(-Infinity);
  change();
  expect(localEditAt(surface)).toBeGreaterThan(0);
});

test("another participant's commit does not count as this user's edit", () => {
  const { surface, change } = fakeSurface('alice');
  change('bob');
  expect(localEditAt(surface)).toBe(-Infinity);
  change('alice');
  expect(localEditAt(surface)).toBeGreaterThan(0);
});
