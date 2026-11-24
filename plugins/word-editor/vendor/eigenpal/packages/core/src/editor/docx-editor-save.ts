import { refreshGuardSet, setRefreshWriteGuard } from './refresh-write-guard.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { editorError } from './docx-editor-support.ts';
import { commitTextFormInput } from './surface-text-form-fields.ts';
import { pendingSurfaceCommit } from './surface-commit-state.ts';
import { runStepsInSlices } from './sliced-steps.ts';

/**
 * Save pending form values without changing focus or opening validation dialogs.
 *
 * The document is captured when the save starts, and the bytes describe it as it was then,
 * even if another document loads before they are ready. Serializing runs in short tasks, so
 * typing and scrolling stay responsive while a long document saves; edits made meanwhile
 * belong to the next save.
 */
export async function saveEditorDocument(
  surface: PaginatedSurface | null,
  container: HTMLElement | null,
  currentSurface: () => PaginatedSurface | null
): Promise<ArrayBuffer> {
  if (!surface) throw editorError('notFound', 'no document is loaded');
  const pending = container ? pendingSurfaceCommit(container) : undefined;
  if (pending) {
    await pending;
    if (currentSurface() !== surface)
      throw editorError(
        'invalidState',
        'The document changed before the pending save could finish.'
      );
  }
  const bytes = await runStepsInSlices(surface.saveSteps(), container);
  return bytes.slice().buffer as ArrayBuffer;
}

/** Synchronous saves refuse reentrant edits before reading incomplete form state. */
export function saveSurfaceDocument(
  surface: PaginatedSurface,
  container: HTMLElement,
  isDestroyed: () => boolean
): Uint8Array {
  return captureSurfaceSave(surface, container, isDestroyed, () => surface.session.save());
}

/**
 * {@link saveSurfaceDocument} in steps. Form input commits and REF results refresh at the call,
 * and the package is captured then, so the steps can run while the document moves on.
 */
export function saveSurfaceDocumentSteps(
  surface: PaginatedSurface,
  container: HTMLElement,
  isDestroyed: () => boolean
): Generator<void, Uint8Array> {
  return captureSurfaceSave(surface, container, isDestroyed, () => surface.session.saveSteps());
}

function captureSurfaceSave<T>(
  surface: PaginatedSurface,
  container: HTMLElement,
  isDestroyed: () => boolean,
  capture: () => T
): T {
  const assertLive = () => {
    if (isDestroyed()) throw editorError('destroyed', 'Cannot save a destroyed surface.');
  };
  assertLive();
  if (pendingSurfaceCommit(container)) {
    throw editorError(
      'invalidState',
      'Cannot save during an active edit. Retry after the edit finishes.'
    );
  }
  surface.flushPendingInput();
  assertLive();
  const refusal = commitTextFormInput(container);
  if (refusal) {
    throw editorError(
      refusal,
      'Cannot save pending text form input. Enter a valid value in each field.'
    );
  }
  assertLive();
  surface.refreshRefFieldResults();
  assertLive();
  const guarded = refreshGuardSet(container);
  setRefreshWriteGuard(container, true);
  try {
    return capture();
  } finally {
    setRefreshWriteGuard(container, guarded);
  }
}
