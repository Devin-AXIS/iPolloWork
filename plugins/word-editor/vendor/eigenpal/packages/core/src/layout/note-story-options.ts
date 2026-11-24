// Note story layout options for one page's note area.

import type { LayoutNoteStoryOptions } from './note-layout.ts';
import type { NotesLayoutInput } from './note-pagination.ts';
import type { NoteMarkContext } from './note-projection.ts';

/**
 * The options a note story is laid out with. `sectionIndex` names the section whose line grid
 * the note lines snap to: the section of the first reference the area holds.
 */
export function noteStoryOptions(
  input: NotesLayoutInput,
  noteMarks: NoteMarkContext | undefined,
  sectionIndex: number
): LayoutNoteStoryOptions {
  return {
    lineGridPitchPt: input.lineGridPitchBySection?.[sectionIndex],
    measurer: input.measurer,
    producer: input.producer,
    displayMode: input.displayMode,
    cache: input.cache,
    styleCascade: input.styleCascade,
    numberingIndex: input.numberingIndex,
    defaultTabStopPt: input.defaultTabStopPt,
    compatibilityMode: input.compatibilityMode,
    revisionAuthorFilter: input.revisionAuthorFilter,
    projectLink: input.projectLink,
    projectLinkForPart: input.projectLinkForPart,
    projectFieldLink: input.projectFieldLink,
    showFieldCodes: input.showFieldCodes,
    documentProperties: input.documentProperties,
    refFields: input.refFields,
    noteMarks,
    drawingsForPart: input.drawingsForPart,
    projectionTokenForParagraphForPart: input.projectionTokenForParagraphForPart,
    projectionTokenForTableForPart: input.projectionTokenForTableForPart,
  };
}
