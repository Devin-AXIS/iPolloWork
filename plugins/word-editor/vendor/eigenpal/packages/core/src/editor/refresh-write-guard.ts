// The external-refresh write guard, and the surface's write-refusal reasons it is the home of:
// the refresh sentence and the placeholder for a write that refused without saying why.

import type { PaginatedSurface } from './paginated-surface-contract.ts';

/** Why a write is refused while an external document refresh holds the guard. */
export const REFRESH_WRITE_REFUSAL = 'An external document refresh is in progress.';
/** What the surface records for a write that refused without saying why. */
export const UNEXPLAINED_WRITE_REFUSAL = 'rejected';
/** Why every write is refused while a preview of other wording is open over the document. */
export const PREVIEW_WRITE_REFUSAL = 'A preview is open. Commit or discard it before editing.';

const guarded = new WeakSet<HTMLElement>();
const previewing = new WeakSet<HTMLElement>();
const compositions = new WeakMap<PaginatedSurface, () => boolean>();
/** Whether any guard refuses writes to the editor in `container`: a refresh or a preview. */
export const refreshWriteBlocked = (container: HTMLElement): boolean =>
  guarded.has(container) || previewing.has(container);
/** Whether the refresh guard itself is set, ignoring a preview. Save restores exactly this. */
export const refreshGuardSet = (container: HTMLElement): boolean => guarded.has(container);
/** The refusal sentence for a blocked container. The refresh wins when both guards are set. */
export const writeBlockReason = (container: HTMLElement): string =>
  !guarded.has(container) && previewing.has(container)
    ? PREVIEW_WRITE_REFUSAL
    : REFRESH_WRITE_REFUSAL;
export function setRefreshWriteGuard(container: HTMLElement, blocked: boolean): void {
  if (blocked) guarded.add(container);
  else guarded.delete(container);
}
/** Refuse every write to the editor in `container` while a preview is open over it. */
export function setPreviewWriteGuard(container: HTMLElement, blocked: boolean): void {
  if (blocked) previewing.add(container);
  else previewing.delete(container);
}
export function registerRefreshComposition(surface: PaginatedSurface, read: () => boolean): void {
  compositions.set(surface, read);
}
export const refreshCompositionActive = (surface: PaginatedSurface): boolean =>
  compositions.get(surface)?.() ?? false;

/** Commands that change neither the document nor its history: a preview leaves them working. */
const PREVIEW_READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  'toggleReviewPane',
  'toggleParagraphMarks',
  'selectAll',
  'setSelection',
  'copyFormatting',
]);
/** Whether a preview, and nothing else, blocks `container`, and `command` writes nothing. */
export const previewAllows = (
  container: HTMLElement,
  command: { readonly type: string }
): boolean =>
  !guarded.has(container) &&
  previewing.has(container) &&
  PREVIEW_READ_ONLY_COMMANDS.has(command.type);

/** The refusal of `command` while a guard blocks writes to the editor in `container`, or null. */
export const writeBlockRefusal = (
  container: HTMLElement | null | undefined,
  command: { readonly type: string }
): { readonly ok: false; readonly code: 'unsupported'; readonly reason: string } | null =>
  container && refreshWriteBlocked(container) && !previewAllows(container, command)
    ? { ok: false, code: 'unsupported', reason: writeBlockReason(container) }
    : null;
