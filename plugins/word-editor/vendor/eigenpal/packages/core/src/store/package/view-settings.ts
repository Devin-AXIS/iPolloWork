// What `settings.xml` says about how the document should be SHOWN.
//
// Distinct from the tracking settings next door, which say what editing may do. These change
// nothing about the content and never reach the file on save — they are the document's own
// answer to a presentation question the schema happens to record.
//
// Only one so far, and it is an inversion worth reading carefully.

import { isSettingsElement, settingsOnOff } from './settings-onoff.ts';
import type { OoxmlNode } from './ooxml-tree.ts';

/** Presentation settings the document itself states. Absence is the answer, never an error. */
export interface DocumentViewSettings {
  /**
   * `w:doNotShadeFormData` (§17.15.1.49) — do NOT shade legacy form fields.
   *
   * Word draws a grey block behind every `w:ffData` field so a reader can find the blanks in a
   * form. It is on by DEFAULT, and this element is how a document turns it off, so the absent
   * case means shading. Reading the name as "shade form data" inverts it and blanks the shading
   * on exactly the documents that asked for it loudest.
   *
   * Never printed, by Word or by us: it marks where to type, and a printed form has no blanks
   * to find.
   */
  readonly doNotShadeFormData: boolean;
}

/** The defaults a document with no `settings.xml` gets: everything Word would shade, shaded. */
export const DEFAULT_VIEW_SETTINGS: DocumentViewSettings = Object.freeze({
  doNotShadeFormData: false,
});

/** Read the view settings from a `settings.xml` root, or the defaults when it has none. */
export function readViewSettings(settingsRoot: OoxmlNode | null | undefined): DocumentViewSettings {
  if (!isSettingsElement(settingsRoot)) return DEFAULT_VIEW_SETTINGS;
  return { doNotShadeFormData: settingsOnOff(settingsRoot, 'doNotShadeFormData') };
}
