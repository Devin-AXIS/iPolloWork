// The last step of a layout pass: page-level results that read the finished pages.

import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import { attachContentControlBoundaries } from './content-control-boundary-layout.ts';
import { withSectionBreakMarks } from './section-break-marks.ts';
import type { DocumentSection } from './section-properties.ts';
import { alignSectionPagesVertically, sectionsAlignVertically } from './section-vertical-align.ts';
import type { SemanticLayout } from './semantic-records.ts';

/**
 * Publish a finished pass: section vertical alignment, content-control boundaries, and
 * section-break marks.
 *
 * `published` is what consumers read. `retained` is what the layout session keeps for the
 * next pass. It holds top-aligned pages, because the next pass flows against them and reuses
 * them; the two are the same layout when no page moves.
 */
export function publishLayoutPass(
  layout: SemanticLayout,
  part: OoxmlPart,
  controlToken: string,
  allBlocks: readonly OoxmlElement[],
  sections: readonly DocumentSection[],
  blocks: readonly OoxmlElement[]
): { readonly published: SemanticLayout; readonly retained: SemanticLayout } {
  const publish = (pages: SemanticLayout): SemanticLayout =>
    withSectionBreakMarks(
      attachContentControlBoundaries(pages, part, controlToken),
      part,
      allBlocks
    );
  // Align the RETAINED pages, not the raw ones: the next pass hands back the retained pages,
  // so the per-page alignment memo must be keyed on them, or every page moves and repaints
  // again on a pass that changed nothing.
  const retained = publish(layout);
  const aligned = alignSectionPagesVertically(retained, sections, blocks);
  return { published: aligned === retained ? retained : publish(aligned), retained };
}

/**
 * Section vertical alignment for the pages a pass shows before it ends, or `undefined` when no
 * section aligns. It moves the pages the pass completed, as the finished pass will, and draws
 * their content-control bounds again where they moved. The pages after them come from the
 * published layout and are aligned already.
 */
export function interimSectionAligner(
  part: OoxmlPart,
  controlToken: string,
  sections: readonly DocumentSection[],
  blocks: readonly OoxmlElement[]
): ((layout: SemanticLayout, completed: number) => SemanticLayout) | undefined {
  if (!sectionsAlignVertically(sections)) return undefined;
  return (layout, completed) => {
    const aligned = alignSectionPagesVertically(layout, sections, blocks, completed);
    return aligned === layout
      ? layout
      : attachContentControlBoundaries(aligned, part, controlToken);
  };
}
