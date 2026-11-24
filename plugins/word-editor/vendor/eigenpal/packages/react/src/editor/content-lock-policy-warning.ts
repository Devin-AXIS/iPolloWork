// Development warning for a `contentLockPolicy` prop that changes after the editor exists.
//
// The editor reads `contentLockPolicy` once, when it is created. The comparison is by value,
// not identity, so an inline object literal re-created on every render does not warn.
// A changed value is ignored, and this says so once, never in a production build.

import type { ContentLockPolicy } from '@docx-editor.dev/core/editor';
import { isDevelopment } from '../lib/is-development';

let printed = false;

const allowsFormatting = (policy: ContentLockPolicy | undefined): boolean =>
  policy?.allowFormattingInLockedContent === true;

/** Warn once when `contentLockPolicy` differs in value from the one the editor was created with. */
export function warnContentLockPolicyChanged(
  created: ContentLockPolicy | undefined,
  current: ContentLockPolicy | undefined
): void {
  if (allowsFormatting(created) === allowsFormatting(current) || printed || !isDevelopment()) {
    return;
  }
  printed = true;
  console.warn(
    '[docx-editor] contentLockPolicy changed after the editor was created, so the change is ' +
      'ignored. The editor reads contentLockPolicy once; create a new editor to change it.'
  );
}
