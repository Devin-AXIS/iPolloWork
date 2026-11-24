// Development warning for a `lockedControlNavigation` prop that changes after the editor exists.
//
// The editor reads `lockedControlNavigation` once, when it is created: the mode decides how the
// caret steps through content-locked inline controls for the life of the instance. A changed
// prop is ignored, and this says so once, never in a production build.

import { isDevelopment } from '../lib/is-development';

let printed = false;

/** `undefined` means the default, `'characters'`, so the two compare equal. */
function normalize(value: unknown): unknown {
  return value === undefined ? 'characters' : value;
}

/** Warn once when `lockedControlNavigation` differs from the value the editor was created with. */
export function warnLockedControlNavigationChanged(created: unknown, current: unknown): void {
  if (normalize(created) === normalize(current) || printed || !isDevelopment()) return;
  printed = true;
  console.warn(
    '[docx-editor] lockedControlNavigation changed after the editor was created, so the ' +
      'change is ignored. The editor reads lockedControlNavigation once; create a new editor ' +
      'to change it.'
  );
}
