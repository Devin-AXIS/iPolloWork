// `w:pageBreakBefore` (ECMA-376 Part 1 §17.3.1.23): where a paragraph opens a page, and whether
// it keeps its space before there.

import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { paragraphAutoSpacingSides, paragraphBreaksBefore } from './paragraph-style.ts';
import { markIgnoresPageBreakBefore } from './section-mark-break.ts';

interface BreakingParagraph {
  readonly paragraph: OoxmlElement;
  readonly props: readonly OoxmlProperty[];
}

/**
 * The page-break-before reads of one section's blocks.
 *
 * `breaksBeforeAt` is the authored break, except on an empty section mark after its section's
 * content. `keepsBeforeAtPageStart` says whether a paragraph keeps its space before when it
 * opens a page. A section's first block does, also when its own page break before opens the
 * page from a continuous section; a paragraph after a leading table is not one. Any other
 * paragraph with a page break before does only in legacy compatibility modes. Ordinary
 * pagination drops it. `opensSection` must turn false once any in-flow block is placed.
 *
 * `spaceBeforeAt` is the space before a paragraph asks for. The document's first paragraph
 * takes no automatic space before (`w:beforeAutospacing`), as an HTML page's first block
 * does, also below a header that pushes the body down. An authored measurement stays.
 */
export function pageBreakBeforeRules(
  sectionBlockCount: number,
  compatibilityMode: number | undefined,
  opensSection: () => boolean,
  opensDocument = false
) {
  const breakKeepsBefore = hasCompatibilityRule(compatibilityMode, 'pageBreakBeforeKeepsSpace');
  const breaksBeforeAt = (at: number, entry: BreakingParagraph): boolean =>
    paragraphBreaksBefore(entry.props) &&
    !markIgnoresPageBreakBefore(entry.paragraph, at, sectionBlockCount);
  return {
    breaksBeforeAt,
    keepsBeforeAtPageStart: (at: number, entry: BreakingParagraph): boolean =>
      opensSection() || ((breakKeepsBefore || at === 0) && breaksBeforeAt(at, entry)),
    spaceBeforeAt: (at: number, entry: BreakingParagraph, before: number): number =>
      opensDocument && at === 0 && opensSection() && paragraphAutoSpacingSides(entry.props).before
        ? 0
        : before,
  };
}
