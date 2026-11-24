/**
 * Types for the adapter's manager classes.
 *
 * Only the error manager survives the greenfield rebuild. The editor handle, auto-save,
 * table-selection, and plugin-lifecycle types that used to live here described the v1
 * adapter and had no callers; the plugin-lifecycle one also forced a `prosemirror-view`
 * import into a package that must not depend on ProseMirror. They are gone rather than
 * stubbed, so nothing here needs an opaque placeholder for a model this package cannot see.
 *
 * @packageDocumentation
 * @public
 */

/** Error severity levels. */
export type ErrorSeverity = 'error' | 'warning' | 'info';

/** A single error surfaced to the user. */
export interface ErrorNotification {
  id: string;
  message: string;
  severity: ErrorSeverity;
  details?: string;
  timestamp: number;
  dismissed?: boolean;
}

/** ErrorManager snapshot. */
export interface ErrorManagerSnapshot {
  notifications: ErrorNotification[];
}
