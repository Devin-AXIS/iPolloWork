import type {
  SemanticTableStructure,
  TableAnchorFrames,
  TableFloatPosition,
} from './semantic-table.ts';
import { contentInsets } from './table-cell-geometry.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';

/**
 * Where a table's left edge sits, floated or not.
 *
 * Before mode 15 a floating table aligns its cell content, not its outer edges. A numeric
 * offset or a left or inside alignment, against any anchor, positions the first row's leading
 * cell content edge; a centered table keeps its outer edges. A right or outside
 * alignment, against any anchor, moves the table right by its own right cell margin, so its
 * content ends at the frame edge. A table whose wrap band already covers the text column's
 * leading edge keeps its outer edge, and so its place across the column.
 */
export function positionedTableOriginX(
  structure: SemanticTableStructure,
  frames: TableAnchorFrames,
  compatibilityMode?: number
): number {
  const float = structure.float;
  if (!float) return frames.text.left + tableOriginX(structure, frames.text.width);
  const width = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const origin = tableFloatOriginX(float, width, frames);
  const first = structure.rows[0]?.cells[0];
  if (
    !hasCompatibilityRule(compatibilityMode, 'floatingTableContentOrigin') ||
    structure.bidiVisual ||
    structure.cellSpacingPt !== 0
  )
    return origin;
  // A right alignment moves by the table's own right cell margin, not a cell's `w:tcMar`.
  if (float.xSpec === 'right' || float.xSpec === 'outside') {
    if (origin - (float.distances?.left ?? 0) <= frames.text.left) return origin;
    return origin + structure.defaultMargins.right;
  }
  if (!first || first.gridColumn !== 0 || float.xSpec === 'center') return origin;
  // Any anchor (17.4.58, 17.4.66), with a `w:tblpX` offset or a left or inside alignment: the
  // leading cell content edge takes the position, and the outer edge may leave the sheet.
  const inset = contentInsets(first.margins, first.contentBorders ?? first.borders).left;
  return origin - inset;
}

/** The painted width of a simple side rule, else `0`. */
function simpleRulePt(
  edge: { readonly state: string; readonly style?: string; readonly widthPt?: number } | undefined
): number {
  if (edge?.state !== 'edge' || (edge.style !== 'single' && edge.style !== 'thick')) return 0;
  return Number.isFinite(edge.widthPt) && edge.widthPt! > 0 ? edge.widthPt! : 0;
}

/**
 * The content inset of a legacy content-aligned table on its visual left: the margin of that
 * cell, or its centred outer rule's inner half where the margin is narrower. The content edge
 * of the reading-order leading side meets the text edge; the trailing side of a right-to-left
 * table places by its margin alone, so `placement` gives the margin there.
 */
export function legacyLeadingInsetPt(
  structure: SemanticTableStructure,
  use: 'width' | 'placement' = 'width'
): number {
  // Right-to-left rows keep document order with physical sides: the last cell is visual left.
  const cell = structure.bidiVisual ? structure.rows[0]?.cells.at(-1) : structure.rows[0]?.cells[0];
  const margin = cell?.margins.left ?? 0;
  if (structure.bidiVisual && use === 'placement') return margin;
  return Math.max(margin, simpleRulePt((cell?.contentBorders ?? cell?.borders)?.left) / 2);
}

/**
 * The visual right counterpart of {@link legacyLeadingInsetPt}. A right-to-left table's
 * leading side is its visual right, so its content edge meets the text edge there.
 */
export function legacyTrailingInsetPt(structure: SemanticTableStructure): number {
  const cell = structure.bidiVisual ? structure.rows[0]?.cells[0] : structure.rows[0]?.cells.at(-1);
  const margin = cell?.margins.right ?? 0;
  return Math.max(margin, simpleRulePt((cell?.contentBorders ?? cell?.borders)?.right) / 2);
}

/**
 * How far a table reaches past the text column, both sides together, when it puts the content
 * of its outer cells on the text edges: its outer content insets. Other tables reach nothing.
 */
export function contentAlignedReachPt(structure: SemanticTableStructure): number {
  if (!structure.legacyContentAlignment && structure.legacyContentOffsetPt === undefined) return 0;
  return legacyLeadingInsetPt(structure) + legacyTrailingInsetPt(structure);
}

/** The table indent of an autofit table, which moves only a table aligned to its leading edge. */
export function leadingIndentPt(structure: SemanticTableStructure): number {
  const leading = structure.bidiVisual ? 'right' : 'left';
  // A negative indent moves a top-level table into the margin, which adds room. A floating
  // table is placed by its own position, so its indent moves nothing.
  if (structure.float) return 0;
  return structure.alignment === leading ? structure.indentPt : 0;
}

/**
 * Where a table's left edge sits inside the box that contains it.
 *
 * Ordinary left-aligned tables start at their indent, which may be negative and is not
 * limited to the remaining width. Centered and right-aligned left-to-right tables use the
 * remaining width and ignore the indent. `outerRuleOffsetPt` then moves the grid inward by
 * half the outer side rule where the table puts that rule's outer edge on the aligned edge.
 * For a supported mode-14 fixed table, that offset instead aligns the first cell's content.
 * A legacy content-aligned table instead puts the content edge of its leading or trailing
 * cell on the aligned edge of the text column; its indent still applies from the leading edge.
 */
export function tableOriginX(structure: SemanticTableStructure, containerWidthPt: number): number {
  return alignedOriginX(structure, containerWidthPt) + (structure.textBoxBidiShiftPt ?? 0);
}

function alignedOriginX(structure: SemanticTableStructure, containerWidthPt: number): number {
  const width = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const slack = containerWidthPt - width;
  if (!Number.isFinite(slack)) return 0;
  if (structure.legacyContentAlignment && structure.alignment !== 'center') {
    // The leading or trailing cell's content edge sits on the aligned text edge. The indent
    // moves the table from its leading edge.
    const last = structure.rows[0]?.cells.at(-1)?.margins.right ?? 0;
    const first = legacyLeadingInsetPt(structure, 'placement');
    // A text box puts the trailing outer edge on the trailing text edge, in either direction.
    if (structure.alignment === 'left' && structure.bidiVisual)
      return structure.legacyTrailingOuterEdge ? 0 : -first;
    if (structure.alignment === 'left') return structure.indentPt - first;
    if (structure.bidiVisual) return slack + legacyTrailingInsetPt(structure) - structure.indentPt;
    return structure.legacyTrailingOuterEdge ? slack : slack + last;
  }
  if (structure.alignment === 'center')
    return (
      slack / 2 +
      (structure.bidiVisual || structure.cellSpacingPt > 0 ? (structure.outerRuleOffsetPt ?? 0) : 0)
    );
  // Travels with the cell insets that `withSharedGridLineSideRules` gives the same table.
  const ruleOffset = structure.outerRuleOffsetPt ?? 0;
  // A bidiVisual table aligned to its leading (right) edge measures the indent from that edge.
  if (structure.alignment === 'right')
    return structure.bidiVisual ? slack - structure.indentPt + ruleOffset : slack + ruleOffset;
  if (structure.bidiVisual) return ruleOffset;
  // Captured controls apply the whole indent whatever the table width: a negative indent
  // pulls the table into the leading margin, and a positive one can push it past the
  // trailing edge. `readTableIndentPt` bounds the value.
  return structure.indentPt + ruleOffset;
}

/**
 * Where a floated table's left edge sits, in the coordinates layout reports boxes in.
 *
 * `w:tblpXSpec` aligns the table inside its anchor box; `w:tblpX` offsets it from that
 * box's leading edge instead. `inside`/`outside` are the mirrored-margin spellings of
 * `left`/`right` and render as those — the odd/even page flip they ask for only exists in
 * a document with mirrored margins, which this layout does not model.
 *
 * The result keeps the table's leading edge on the sheet whatever the file states, so a
 * hostile offset moves the table rather than painting it off the page entirely.
 */
export function tableFloatOriginX(
  float: TableFloatPosition,
  tableWidthPt: number,
  frames: TableAnchorFrames
): number {
  const frame = frames[float.horzAnchor];
  const slack = frame.width - tableWidthPt;
  let x: number;
  if (float.xSpec === 'center') x = frame.left + slack / 2;
  else if (float.xSpec === 'right' || float.xSpec === 'outside') x = frame.left + slack;
  else if (float.xSpec) x = frame.left;
  else x = frame.left + float.xPt;
  if (!Number.isFinite(x)) return frame.left;
  const pageRight = frames.page.left + frames.page.width;
  return Math.max(frames.page.left, Math.min(x, pageRight));
}

/**
 * How far a centered top-level AutoFit table with an absolute width may reach past the text
 * column, both sides together, before compatibility mode 15: its outer content insets. Its
 * stated width still decides while its columns fit; columns that need more than the text
 * column fill it with their content edges on the text edges, and the table stays centered.
 *
 * Measured with 5.4pt cell margins in a 468pt column: a 450pt table whose columns need 531pt
 * spans 479pt, from 5.5pt before the column to 5.5pt past it, in modes 11 to 14. Mode 15 keeps
 * the 468pt column. Right-to-left, spaced, fixed, floating and text-box tables reach nothing,
 * for want of evidence.
 */
export function centeredLegacyReachPt(
  structure: SemanticTableStructure,
  compatibilityMode: number | undefined,
  depth: number
): number {
  if (
    !hasCompatibilityRule(compatibilityMode, 'fixedTableContentEdgeOrigin') ||
    depth !== 0 ||
    structure.alignment !== 'center' ||
    structure.tableWidth.type !== 'dxa' ||
    structure.layoutFixed ||
    structure.float ||
    structure.textBox ||
    structure.bidiVisual ||
    structure.cellSpacingPt !== 0
  )
    return 0;
  return legacyLeadingInsetPt(structure) + legacyTrailingInsetPt(structure);
}
