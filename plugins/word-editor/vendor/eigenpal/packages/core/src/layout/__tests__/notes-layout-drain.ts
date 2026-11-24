// Runs the notes layout path to its end over a body pass that does not report progress.

import type { OoxmlPart } from '@docx-editor.dev/core/store';
import { drainLayoutSteps } from '../layout-steps.ts';
import { layoutSemanticDocumentWithNotesSteps, type NotesLayoutInput } from '../note-pagination.ts';
import type { NotesBodyOptions } from '../note-progress.ts';
import type { DocumentSection } from '../section-properties.ts';
import type { SemanticLayout } from '../semantic-records.ts';

export function layoutSemanticDocumentWithNotes<Opts extends NotesBodyOptions>(
  part: OoxmlPart,
  sections: readonly DocumentSection[],
  options: Opts,
  notesInput: NotesLayoutInput,
  runBody: (opts: Opts) => SemanticLayout
): SemanticLayout {
  return drainLayoutSteps(
    layoutSemanticDocumentWithNotesSteps(part, sections, options, notesInput, function* (opts) {
      return runBody(opts);
    })
  );
}
