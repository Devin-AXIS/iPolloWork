// The structure of a table whose autofit columns widened past the widths it was read with.

import { retargetSharedGridLineSideRules } from './legacy-table-side-rules.ts';
import { withLegacyRowPlacement } from './legacy-row-placement.ts';
import { mirroredAlignment } from './table-alignment.ts';
import type { SemanticTableStructure } from './semantic-table.ts';

/**
 * Widened structures per base, by their widths. Readers that widen one base differently (two
 * measurers, two field contexts) keep separate entries instead of evicting each other.
 */
const widenedStructureMemos = new WeakMap<
  SemanticTableStructure,
  Map<string, SemanticTableStructure>
>();
const MAX_WIDENED_PER_BASE = 4;

/** `base` at the autofit `widths`, its shared grid line side rules moved with them. */
export function widenedTableStructure(
  base: SemanticTableStructure,
  widths: readonly number[],
  context: {
    readonly compatibilityMode: number | undefined;
    readonly depth: number;
    readonly contentWidthPt: number;
  }
): SemanticTableStructure {
  const widthsKey = widths.join(',');
  let widened = widenedStructureMemos.get(base);
  const known = widened?.get(widthsKey);
  if (known) return known;
  const sideRules = retargetSharedGridLineSideRules(
    base.rows,
    {
      compatibilityMode: context.compatibilityMode,
      depth: context.depth,
      bidiVisual: base.bidiVisual === true,
      floating: base.float !== undefined,
      cellSpacingPt: base.cellSpacingPt,
      widthType: base.tableWidth.type,
      ...(base.tableWidth.type === 'dxa' ? { statedWidthPt: base.tableWidth.value } : {}),
      // The structure stores the visual alignment; side rules take the authored one.
      alignment: base.bidiVisual ? mirroredAlignment(base.alignment) : base.alignment,
      layoutFixed: base.layoutFixed,
      indentPt: base.indentPt,
      columnWidthsPt: base.columnWidthsPt,
      containerWidthPt: context.contentWidthPt,
      ...(base.textBox ? { textBox: true } : {}),
    },
    widths
  );
  // A legacy content-edge offset does not depend on the widths, nor does a spaced table's
  // frame offset; shared grid line offsets move with them.
  const { outerRuleOffsetPt: _previousOffset, ...unchanged } = base;
  const offset =
    base.legacyContentOffsetPt ??
    (base.cellSpacingPt > 0 ? base.outerRuleOffsetPt : sideRules.outerRuleOffsetPt);
  // Centred and trailing-aligned rows of a legacy table move with the width.
  const structure = withLegacyRowPlacement(
    {
      ...unchanged,
      columnWidthsPt: widths,
      rows: sideRules.rows,
      ...(offset === undefined ? {} : { outerRuleOffsetPt: offset }),
    },
    context
  );
  if (!widened) widenedStructureMemos.set(base, (widened = new Map()));
  if (widened.size >= MAX_WIDENED_PER_BASE) widened.delete(widened.keys().next().value!);
  widened.set(widthsKey, structure);
  return structure;
}

/**
 * A nested AutoFit table in a fixed-layout cell, at the widths its grid, cell widths and table
 * width resolve to. It never widens for its content: a word that does not fit breaks inside
 * its column. In an AutoFit parent it widens, and the parent column with it. A grid
 * narrower than a stated absolute width stretches to that width, in proportion, when the
 * width fits the container.
 */
export function nestedAutofitStructure(
  base: SemanticTableStructure,
  autofit: { readonly parentTableFixed?: true },
  context: Parameters<typeof widenedTableStructure>[2]
): SemanticTableStructure | undefined {
  if (context.depth === 0 || base.layoutFixed || !autofit.parentTableFixed) return undefined;
  const stated = base.tableWidth.type === 'dxa' ? base.tableWidth.value : 0;
  let total = 0;
  for (const width of base.columnWidthsPt) total += width;
  // A stated width past the container keeps the grid: no reference covers that shape.
  if (!(total > 0) || !(stated > total + 1e-6) || stated > context.contentWidthPt + 1e-6) {
    return base;
  }
  const scale = stated / total;
  return widenedTableStructure(
    base,
    base.columnWidthsPt.map((width) => width * scale),
    context
  );
}
