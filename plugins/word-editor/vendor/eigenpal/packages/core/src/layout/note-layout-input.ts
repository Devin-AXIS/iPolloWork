// The notes pass's input, completed from the body pass's options.

import type { NotesLayoutInput } from './note-pagination.ts';

/**
 * Note stories run the same paragraph walk as the body, so they inherit the body's link
 * projector seams and document properties unless the notes input pinned its own — without which
 * a `w:hyperlink`, HYPERLINK field, or document-property field in a footnote painted as dead or
 * blank text while the body's twin resolved.
 */
export function inheritNotesLayoutInput(
  notes: NotesLayoutInput,
  body: {
    readonly projectLink?: NotesLayoutInput['projectLink'];
    readonly projectFieldLink?: NotesLayoutInput['projectFieldLink'];
    /** Field-code inspection projection. @internal */
    readonly showFieldCodes?: boolean;
    readonly documentProperties?: NotesLayoutInput['documentProperties'];
    readonly refFields?: NotesLayoutInput['refFields'];
    readonly displayMode?: NotesLayoutInput['displayMode'];
    readonly revisionAuthorFilter?: NotesLayoutInput['revisionAuthorFilter'];
  }
): NotesLayoutInput {
  const projectLink = notes.projectLink ?? body.projectLink;
  const projectFieldLink = notes.projectFieldLink ?? body.projectFieldLink;
  const documentProperties = notes.documentProperties ?? body.documentProperties;
  const refFields = notes.refFields ?? body.refFields;
  const displayMode = notes.displayMode ?? body.displayMode;
  const revisionAuthorFilter = notes.revisionAuthorFilter ?? body.revisionAuthorFilter;
  return {
    ...notes,
    ...(projectLink ? { projectLink } : {}),
    ...(projectFieldLink ? { projectFieldLink } : {}),
    showFieldCodes: notes.showFieldCodes ?? body.showFieldCodes,
    ...(documentProperties ? { documentProperties } : {}),
    ...(refFields ? { refFields } : {}),
    ...(displayMode ? { displayMode } : {}),
    ...(revisionAuthorFilter ? { revisionAuthorFilter } : {}),
  };
}
