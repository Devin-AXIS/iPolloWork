import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import { resolveStoryRefFieldsWithNoteNumbers } from './field-ref.ts';
import { noteRefNumberingFromNotes } from './field-noteref.ts';
import { enumerateDocumentSectionsFromBlocks, type DocumentSection } from './section-properties.ts';
import type { SemanticLayoutOptions } from './semantic-layout-options.ts';
import { styleSeparatorSourceBlocks } from './style-separator-group.ts';

/** Field lookup retains source paragraph ownership and uses the same section walk. */
export function resolveBodyRefFields(
  part: OoxmlPart,
  blocks: readonly OoxmlElement[],
  sections: readonly DocumentSection[],
  options: SemanticLayoutOptions
) {
  const sourceBlocks = styleSeparatorSourceBlocks(blocks);
  const sourceSections =
    sourceBlocks === blocks
      ? sections
      : enumerateDocumentSectionsFromBlocks(part, sourceBlocks).sections;
  return resolveStoryRefFieldsWithNoteNumbers(
    sourceBlocks,
    options.listItems,
    options.notes
      ? { footnotesPart: options.notes.footnotesPart, endnotesPart: options.notes.endnotesPart }
      : undefined,
    options.notes ? noteRefNumberingFromNotes(options.notes, sourceSections) : undefined,
    options.displayMode,
    options.revisionAuthorFilter
  );
}
