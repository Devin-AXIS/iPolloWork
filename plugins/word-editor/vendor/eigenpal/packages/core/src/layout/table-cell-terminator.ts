import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import { isCellTerminatorMarker, isEmptyCellTerminator } from './story-roots.ts';

/** Where a cell's final paragraph sits in the cell walk. */
export interface CellTerminatorPosition {
  /** A real `w:tc`, not a header, footer, note or text-box story reusing cell flow. */
  readonly inTableCell: boolean;
  /** The paragraph is the cell's last block. */
  readonly last: boolean;
  /** The block before it emitted a nested table fragment. */
  readonly afterEmittedTable: boolean;
  /** The cell hides its end mark from row height (`w:hideMark`). */
  readonly hideEndMark: boolean;
}

/**
 * Whether the cell's final paragraph is placed at the content bottom without flow height.
 *
 * POSITION only. Whether the paragraph actually collapses is decided by what it would
 * publish, and `placeCellParagraph` owns that answer (`publishesPlacedGlyphs`): a list
 * marker or a visible tracked mark keeps its line.
 *
 * Two terminators qualify, and both must be empty (`isEmptyCellTerminator`):
 *
 * - The paragraph a cell must end with after a nested table. `afterEmittedTable` comes from
 *   the walk, not the source node's kind: a `w:tbl` past the nesting ceiling or with no
 *   `w:tr` emits nothing, and collapsing behind it leaves a row with no content and no
 *   terminator, which paints as a hairline. Runs that hold no text keep it empty, in every
 *   mode: its spacing, mark size, exact line height, borders and shading take no room either.
 *   A space or a tab is text, and so is a second paragraph between it and the table.
 * - The empty last paragraph of a `w:hideMark` cell. The end-of-cell mark does not count
 *   toward row height (17.4.25), and an empty final paragraph holds nothing else, so the row
 *   ends with the content above it: no line and no spacing. That holds for an empty cell
 *   too, whose row is then as tall as its cell margins, its `w:trHeight`, or its other
 *   cells. Paragraph borders still draw in an otherwise empty cell, so placement keeps such a
 *   paragraph's line (`collapseInEmptyCell`).
 */
export function cellTerminatorCollapses(
  block: OoxmlElement,
  position: CellTerminatorPosition
): boolean {
  if (!position.inTableCell || !position.last) return false;
  const terminator = position.afterEmittedTable || position.hideEndMark;
  if (!terminator) return false;
  return isEmptyCellTerminator(block) || (position.afterEmittedTable && holdsNoText(block));
}

/** A bound on the empty runs read; a paragraph past it keeps its line. */
const MAX_EMPTY_RUNS = 64;

/**
 * Whether a paragraph holds only properties, structural markers and runs whose text is empty:
 * a run of `w:rPr` and empty `w:t` elements and nothing else.
 */
function holdsNoText(paragraph: OoxmlElement): boolean {
  let runs = 0;
  for (const child of paragraph.children) {
    if (isCellTerminatorMarker(child)) continue;
    if (child.kind === 'textValue' || child.namespaceUri !== WML_NAMESPACE_URI) return false;
    if (child.localName !== 'r' || ++runs > MAX_EMPTY_RUNS || !runHoldsNoText(child)) return false;
  }
  return true;
}

function runHoldsNoText(run: OoxmlElement): boolean {
  for (const part of run.children) {
    if (part.kind === 'textValue') {
      if (part.value.length > 0) return false;
      continue;
    }
    if (part.namespaceUri !== WML_NAMESPACE_URI) return false;
    if (part.localName === 'rPr') continue;
    if (part.localName !== 't') return false;
    for (const text of part.children)
      if (text.kind !== 'textValue' || text.value.length > 0) return false;
  }
  return true;
}

/**
 * Whether a cell hides its end mark from row height (`w:hideMark`, 17.4.25). The first paragraph
 * of the document keeps its mark: a table that opens the body keeps the end-of-cell line of its
 * first cell, so its first row is at least one line tall. `documentFirstParagraphId` names that
 * paragraph when a table opens the body.
 */
export function cellHidesEndMark(
  cell: { readonly hideEndMark?: boolean; readonly blocks: readonly { readonly id: string }[] },
  documentFirstParagraphId: string | undefined
): boolean {
  return cell.hideEndMark === true && cell.blocks.at(-1)?.id !== documentFirstParagraphId;
}

/**
 * The first paragraph of a table that opens the body: the last block of its first cell when that
 * cell holds one paragraph and nothing else. `undefined` for any other first block.
 */
export function documentOpeningCellParagraph(first: OoxmlNode | undefined): string | undefined {
  const elements = (node: OoxmlNode | undefined): OoxmlElement[] => {
    const found: OoxmlElement[] = [];
    if (node && node.kind !== 'textValue')
      for (const item of node.children as readonly OoxmlNode[])
        if (item.kind !== 'textValue' && item.namespaceUri === WML_NAMESPACE_URI)
          found.push(item as OoxmlElement);
    return found;
  };
  if (!first || first.kind === 'textValue' || first.localName !== 'tbl') return undefined;
  const row = elements(first).find((item) => item.localName === 'tr');
  const cell = elements(row).find((item) => item.localName === 'tc');
  const blocks = elements(cell).filter((item) => item.localName !== 'tcPr');
  return blocks.length === 1 && blocks[0]!.localName === 'p' ? blocks[0]!.id : undefined;
}
