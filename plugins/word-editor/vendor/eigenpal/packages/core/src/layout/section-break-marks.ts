// Section break marks: which body paragraphs end a section, and how the next section starts.
//
// A `w:sectPr` describes the section it closes, but its `w:type` says how THAT section began.
// The break drawn at the end of a section is therefore named by the section that follows it.
// The list is rebuilt from the section enumeration on every pass, so a page reused by identity
// can never carry a stale kind when only a later section's `w:type` changed.

import type { OoxmlElement, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { enumerateDocumentSectionsFromBlocks, type DocumentSection } from './section-properties.ts';
import type { SectionBreakMarkRecord, SemanticLayout } from './semantic-records.ts';

/** The section breaks of one body, in document order. */
export function sectionBreakMarks(
  blocks: readonly OoxmlElement[],
  sections: readonly DocumentSection[]
): readonly SectionBreakMarkRecord[] {
  const marks: SectionBreakMarkRecord[] = [];
  for (let index = 0; index + 1 < sections.length; index += 1) {
    const mark = blocks[sections[index]!.blockEndExclusive - 1];
    if (mark?.kind !== 'paragraph') continue;
    marks.push(
      Object.freeze({ paragraphId: mark.id, kind: sections[index + 1]!.properties.breakType })
    );
  }
  return Object.freeze(marks);
}

function sameMarks(
  a: readonly SectionBreakMarkRecord[] | undefined,
  b: readonly SectionBreakMarkRecord[]
): boolean {
  if (a === undefined) return b.length === 0;
  if (a.length !== b.length) return false;
  for (let index = 0; index < b.length; index += 1) {
    if (a[index]!.paragraphId !== b[index]!.paragraphId || a[index]!.kind !== b[index]!.kind)
      return false;
  }
  return true;
}

/**
 * Attach the body's section breaks. Returns `layout` itself when they did not move, so a
 * no-change pass keeps the identity incremental consumers compare.
 *
 * `blocks` is the WHOLE body, never an opening slice: a slice ends in a stand-in final section
 * that would name the last break in it by the body-level `w:sectPr` instead of the real next
 * section, and the label would change when the full pass arrives.
 */
export function withSectionBreakMarks(
  layout: SemanticLayout,
  part: OoxmlPart,
  blocks: readonly OoxmlElement[]
): SemanticLayout {
  const marks = sectionBreakMarks(
    blocks,
    enumerateDocumentSectionsFromBlocks(part, blocks).sections
  );
  if (sameMarks(layout.sectionBreaks, marks)) return layout;
  if (marks.length === 0) {
    const { sectionBreaks: _dropped, ...rest } = layout;
    return rest;
  }
  return { ...layout, sectionBreaks: marks };
}
