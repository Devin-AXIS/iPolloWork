// What `settings.xml` says about TRACKING.
//
// Word records the tracking state on the DOCUMENT, not on the session, so a file can arrive
// asking to be edited as tracked changes and a reader that ignores it presents an ordinary
// editable document — and the first keystroke is an untracked edit in a document whose author
// asked for the opposite.
//
// Four settings, and they say different things:
//
//   - `w:trackRevisions` (§17.15.1.90): edits SHOULD be tracked. A request, and the thing the
//     mode control reflects.
//   - `w:documentProtection/@w:edit="trackedChanges"` (§17.15.1.29): editing is PERMITTED only
//     as tracked changes. Stronger — the mode cannot be left. Advisory, never a security
//     boundary: `@w:hash` is not verified here and the file is editable by anyone holding it.
//     Ignoring it silently is what produces untracked edits in a document that forbade them.
//   - `w:doNotTrackMoves` (§17.15.1.51): a move is written as a deletion and an insertion
//     rather than as a `w:moveFrom`/`w:moveTo` pair.
//   - `w:doNotTrackFormatting` (§17.15.1.50): a formatting change is applied with no
//     `w:rPrChange`.
//
// The last two govern WRITING only. A `w:moveFrom` already in a document that declares
// `w:doNotTrackMoves` is still a move: the setting says what a producer emits from now on, not
// how to read what is already there.
//
// Every value is `ST_OnOff` and every element is optional, so absence is the answer rather
// than an error.

import { isSettingsElement as isElement, settingsOnOff as onOff } from './settings-onoff.ts';
import type { OoxmlNode } from './ooxml-tree.ts';
import { readDocumentProtection } from './document-protection.ts';

/** What the document asks for. Every field defaults to "the document said nothing". */
export interface DocumentTrackingSettings {
  /** `w:trackRevisions` — the document asks for edits to be tracked. */
  readonly trackRevisions: boolean;
  /**
   * `w:documentProtection/@w:edit="trackedChanges"` — tracking may not be turned OFF.
   *
   * Advisory. Presenting it as enforcement would be a lie about a file anyone can edit.
   */
  readonly restrictedToTrackedChanges: boolean;
  /**
   * `w:documentProtection/@w:edit="forms"` enforced — Track Changes is UNAVAILABLE.
   *
   * Word refuses to turn tracking on while a document is protected for filling in forms. A
   * document tracked BEFORE it was protected keeps the revisions it already carries; what the
   * protection stops is making new ones.
   */
  readonly restrictedToForms: boolean;
  /** `w:documentProtection/@w:edit="readOnly"` enforced — no edit is permitted at all. */
  readonly restrictedToReadOnly: boolean;
  /** `w:documentProtection/@w:edit="comments"` enforced — only comments are permitted. */
  readonly restrictedToComments: boolean;
  /** `w:doNotTrackMoves` — write a move as a delete and an insert. */
  readonly doNotTrackMoves: boolean;
  /** `w:doNotTrackFormatting` — apply formatting without recording a `w:rPrChange`. */
  readonly doNotTrackFormatting: boolean;
}

/** The frozen "nothing is tracked" settings — what a document with no `w:trackChanges` gets. */
export const NO_TRACKING_SETTINGS: DocumentTrackingSettings = Object.freeze({
  trackRevisions: false,
  restrictedToTrackedChanges: false,
  restrictedToForms: false,
  restrictedToReadOnly: false,
  restrictedToComments: false,
  doNotTrackMoves: false,
  doNotTrackFormatting: false,
});

/** Read the tracking settings from a `settings.xml` root, or the defaults when it has none. */
export function readTrackingSettings(
  settingsRoot: OoxmlNode | null | undefined
): DocumentTrackingSettings {
  if (!isElement(settingsRoot)) return NO_TRACKING_SETTINGS;
  const documentProtection = readDocumentProtection(settingsRoot);
  return {
    trackRevisions: onOff(settingsRoot, 'trackRevisions'),
    restrictedToTrackedChanges:
      documentProtection.edit === 'trackedChanges' && documentProtection.enforced,
    restrictedToForms: documentProtection.edit === 'forms' && documentProtection.enforced,
    restrictedToReadOnly: documentProtection.edit === 'readOnly' && documentProtection.enforced,
    restrictedToComments: documentProtection.edit === 'comments' && documentProtection.enforced,
    doNotTrackMoves: onOff(settingsRoot, 'doNotTrackMoves'),
    doNotTrackFormatting: onOff(settingsRoot, 'doNotTrackFormatting'),
  };
}
