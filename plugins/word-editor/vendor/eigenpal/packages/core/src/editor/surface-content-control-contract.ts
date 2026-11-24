import type { ContentControlBoundaryRecord } from '@docx-editor.dev/core/layout';

/**
 * Content-control interaction lane on the paginated surface.
 *
 * Chrome toggles are surface state; value / remove commit through tree ops.
 */
export interface ContentControlOps {
  /** Toggle show-all boundary chrome. No layout reflow. */
  setShowAll(show: boolean): void;
  /** Toggle form-fill Tab navigation mode. */
  setFormFill(active: boolean): void;
  /** Whether show-all chrome is on. */
  showAll(): boolean;
  /** Whether form-fill navigation is on. */
  formFill(): boolean;
  /** Innermost control at the caret from layout boundary records. */
  atCaret(): ContentControlBoundaryRecord | null;
  /**
   * Move to the next or previous editable control (tabIndex, then document order).
   *
   * Skips content-locked and bound controls. Selects the control's content for replacement.
   * Returns whether navigation landed somewhere.
   */
  navigate(direction: 'next' | 'previous'): boolean;
  /**
   * Set a control's value through `setContentControlValue`. Honours lock / bound refusals.
   * Returns whether the op committed.
   */
  setValue(controlId: string, value: string): boolean;
  /**
   * Unwrap a control keeping its content (`removeContentControl`). Defaults to the control
   * at the caret. Returns whether the op committed.
   */
  remove(controlId?: string): boolean;
  /**
   * Engine reason a widget or remove action is disabled, or null when allowed.
   *
   * `edit` covers content / value changes; `remove` covers unwrap.
   */
  disabledReason(controlId: string, action: 'edit' | 'remove'): string | null;
}

/**
 * Content-control chrome the surface owns, not the document.
 *
 * Boundary furniture visibility and form-fill navigation are surface chrome, not model
 * bytes — toggling them never reflows layout records.
 */
export interface ContentControlSurfaceState {
  /** Show boundary chrome for every control. */
  readonly showAll: boolean;
  /** Tab / Shift+Tab navigate between editable controls. */
  readonly formFill: boolean;
  /** Innermost control containing the caret, or null. */
  readonly activeControlId: string | null;
}
