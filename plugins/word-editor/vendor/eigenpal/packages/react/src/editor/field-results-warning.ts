// Development warning for a `fieldResults` prop that changes after the editor exists.
//
// The editor reads `fieldResults` once, when it is created: the mode decides how every offset
// in the open document is addressed, so it cannot switch under a live selection and history.
// A changed prop is ignored, and this says so once, never in a production build.

import { isDevelopment } from '../lib/is-development';

let printed = false;

/** Warn once when `fieldResults` differs from the value the current editor was created with. */
export function warnFieldResultsChanged(created: unknown, current: unknown): void {
  if (created === current || printed || !isDevelopment()) return;
  printed = true;
  console.warn(
    '[docx-editor] fieldResults changed after the editor was created, so the change is ' +
      'ignored. The editor reads fieldResults once; create a new editor to change it.'
  );
}
