// What the facade owes a registered custom-node module: a diagnostic channel, and the sweep.

import type { PaginatedSurface } from './paginated-surface.ts';
import type { EditorModuleRegistry } from '../contracts/modules.ts';

/**
 * A reporter over one instance's diagnostic listeners.
 *
 * Per instance, never global: a second editor on the page must not hear about a document it did
 * not open. One listener throwing does not stop the others hearing it.
 */
export function customNodeDiagnosticReporter(
  modules: EditorModuleRegistry
): CustomNodeDiagnosticReporter {
  const observers: ((diagnostic: unknown) => void)[] = [];
  const report = (diagnostic: unknown) => {
    for (const listener of [...modules.customNodeDiagnostics, ...observers]) {
      try {
        listener(diagnostic);
      } catch {
        /* the rest still hear it */
      }
    }
  };
  return Object.assign(report, {
    observe(listener: (diagnostic: unknown) => void) {
      observers.push(listener);
    },
  });
}

/** Reports a custom-node diagnostic; `observe` adds the editor's own anonymous stream. */
export type CustomNodeDiagnosticReporter = ((diagnostic: unknown) => void) & {
  observe(listener: (diagnostic: unknown) => void): void;
};

/**
 * Collect payloads whose control is gone. Call on OPEN and nowhere else.
 *
 * Word does not delete a payload when a user deletes the control bound to it, so a document can
 * arrive holding payloads for chips that no longer exist. Not on save: a chip cut to the
 * clipboard is unbound for as long as it sits there, and a save mid-cut would destroy the
 * payload the user is about to paste.
 */
export function sweepCustomNodePayloadsOnOpen(
  surface: PaginatedSurface,
  modules: EditorModuleRegistry
): void {
  if (modules.customNodePayloadNamespaces.length === 0) return;
  surface.session.sweepCustomNodePayloads(modules.customNodePayloadNamespaces);
}
