// The selected drawing's overlay target, reference-stable while it holds the same values.
//
// Adapters store the target in component state and ask for it after every selection change
// and document change: inside a text box that is every keystroke. A new object each time
// re-renders the overlay and re-runs every effect keyed on it, though nothing moved.

import {
  freshSelectedDrawingOverlayTarget,
  type SelectedDrawingOverlayTarget,
} from './docx-editor-images.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

const lastTargets = new WeakMap<PaginatedSurface, SelectedDrawingOverlayTarget>();

/**
 * The painted geometry of the selected drawing, for the resize/move overlay — or null.
 *
 * Stricter than `selectedImageStateOf`: it also requires a COLLAPSED selection, because a
 * range that merely contains a drawing is a text selection, and drawing handles over it would
 * claim an object the user did not single out. Answers the same object as the previous call
 * for this surface while every value is the same.
 */
export function selectedDrawingOverlayTargetOf(
  surface: PaginatedSurface | null
): SelectedDrawingOverlayTarget | null {
  const next = freshSelectedDrawingOverlayTarget(surface);
  if (!surface) return next;
  if (!next) {
    lastTargets.delete(surface);
    return null;
  }
  const previous = lastTargets.get(surface);
  if (previous && samePlainData(previous, next)) return previous;
  lastTargets.set(surface, next);
  return next;
}

/** Structural equality for the frozen plain data a target holds: numbers, strings, records. */
function samePlainData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      samePlainData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  );
}
