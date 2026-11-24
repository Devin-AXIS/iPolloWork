// Layering border boxes across the table style cascade.
//
// Separate from `table-borders.ts`, which decides which of two ADJACENT cells owns the rule
// between them. This is the earlier question: what a table or cell's borders are once the
// style it names, the conditional formats that style carries, and its own properties have
// all had their say.

import type { CellBorderBox, TableBorderBox, TableBorderSide } from './table-borders.ts';

const NONE: TableBorderSide = { state: 'none' };

const later = (base: TableBorderSide, over: TableBorderSide): TableBorderSide =>
  over.state === 'omitted' ? base : over;

/**
 * What one cell side is before any ADJACENT cell has its say.
 *
 * - omitted → the table's own rule for that position (`tblBorders`, `insideH`/`insideV`)
 * - edge → the cell wins outright; no weight fight with the table
 * - none → an explicit `w:val="nil"`. Suppresses a matching table border on interior
 *   and perimeter sides alike, so a table whose cells all declare none paints borderless
 *   like Word even when `tblBorders` still carry `single` rules.
 */
export function effectiveBorderSide(
  authored: TableBorderSide,
  tableSide: TableBorderSide,
  _options: { readonly interior?: boolean } = {}
): TableBorderSide {
  if (authored.state === 'omitted') return tableSide;
  if (authored.state === 'none') return NONE;
  return authored;
}

/**
 * Layer one border box over another: a side the later box OMITS inherits.
 *
 * This is what makes a table style visible. Word writes the grid into the style's
 * `w:tblBorders` and the document says only `<w:tblStyle w:val="TableGrid"/>`, so a reader
 * that looks at the table's own `w:tblPr` alone draws nothing at all. An explicit `none`
 * is not an omission — it is the document turning the inherited rule off.
 */
export function mergeTableBorders(base: TableBorderBox, over: TableBorderBox): TableBorderBox {
  const side = later;
  return {
    top: side(base.top, over.top),
    left: side(base.left, over.left),
    bottom: side(base.bottom, over.bottom),
    right: side(base.right, over.right),
    insideH: side(base.insideH, over.insideH),
    insideV: side(base.insideV, over.insideV),
  };
}

/** The same layering for a cell box, which has no interior sides. */
export function mergeCellBorders(base: CellBorderBox, over: CellBorderBox): CellBorderBox {
  const side = later;
  const diagonal = (name: 'tl2br' | 'tr2bl'): TableBorderSide | undefined =>
    over[name]?.state === 'omitted' ? base[name] : (over[name] ?? base[name]);
  const tl2br = diagonal('tl2br');
  const tr2bl = diagonal('tr2bl');
  return {
    top: side(base.top, over.top),
    left: side(base.left, over.left),
    bottom: side(base.bottom, over.bottom),
    right: side(base.right, over.right),
    ...(tl2br ? { tl2br } : {}),
    ...(tr2bl ? { tr2bl } : {}),
  };
}

/** Inherit only cell-owned diagonals without applying the layer's physical sides. */
export function mergeCellDiagonalBorders(base: CellBorderBox, over: CellBorderBox): CellBorderBox {
  return mergeCellBorders(base, { ...base, tl2br: over.tl2br, tr2bl: over.tr2bl });
}
