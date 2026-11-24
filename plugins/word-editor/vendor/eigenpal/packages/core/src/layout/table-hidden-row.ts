// Which table rows a hidden row mark removes from the laid-out table.
//
// `w:trPr/w:hidden` (17.4.20) hides the row's end mark. When every cell shows nothing either,
// the row takes no height at all: no line box, no `w:trHeight` minimum, and no border band.
// A row that keeps any visible content, or whose cells keep a visible paragraph mark, keeps its
// full height, so the condition is narrow, like the paragraph rule in `hidden-paragraph-mark.ts`:
//
//   - The row states `w:hidden` itself.
//   - Every cell holds only paragraphs, each with a directly hidden mark and nothing visible.
//     A nested table, a content control, or any other block keeps the row.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { readOnOffChild } from '../store/package/ooxml-shared.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import { paragraphMarkHidden } from './hidden-paragraph-mark.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import { paragraphRendersNothingVisible } from './revision-visibility.ts';

function cellShowsNothing(
  cell: OoxmlElement,
  displayMode: RevisionDisplayMode,
  authorFilter: RevisionAuthorFilter | undefined
): boolean {
  let paragraphs = 0;
  for (const child of cell.children) {
    if (child.kind === 'textValue') return false;
    if (child.namespaceUri === WML_NAMESPACE_URI && child.localName === 'tcPr') continue;
    if (
      child.kind !== 'paragraph' ||
      !paragraphMarkHidden(child) ||
      !paragraphRendersNothingVisible(child, displayMode, authorFilter)
    )
      return false;
    paragraphs += 1;
  }
  return paragraphs > 0;
}

/** The row hides its end mark and every cell in it shows nothing, so it takes no space. */
export function hiddenRowCollapses(
  row: OoxmlElement,
  rowProperties: OoxmlElement | undefined,
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): boolean {
  if (!rowProperties || !readOnOffChild(rowProperties, 'hidden')) return false;
  let cellCount = 0;
  for (const child of row.children) {
    if (child.kind === 'textValue') return false;
    if (
      child.namespaceUri === WML_NAMESPACE_URI &&
      (child.localName === 'trPr' || child.localName === 'tblPrEx')
    )
      continue;
    // A content control around a cell keeps the row.
    if (child.kind !== 'tableCell') return false;
    if (!cellShowsNothing(child, displayMode, authorFilter)) return false;
    cellCount += 1;
  }
  return cellCount > 0;
}
