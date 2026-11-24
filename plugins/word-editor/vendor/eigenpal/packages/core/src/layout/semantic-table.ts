import { cachedTableStructure } from './table-structure-cache.ts';
import { hiddenRowCollapses } from './table-hidden-row.ts';
import { tableHasHidableRevisions } from './table-revision-markup.ts';
import { readConditionalCellBorders } from './conditional-cell-borders.ts';
import {
  revisionCellMetadata,
  wmlRevisionChild,
  wmlRevisionAttribute,
} from './revision-cell-shading.ts';
import { mirroredAlignment, tableAlignmentOf, tableIndentNode } from './table-alignment.ts';
import {
  autoWidthOuterRulePt,
  modernPercentRulePt,
  withSharedGridLineSideRules,
} from './legacy-table-side-rules.ts';
import { nestedAutofitStructure, widenedTableStructure } from './table-widened-structure.ts';
import { withRowMinimumContentInsets } from './table-row-minimum-insets.ts';
// Bounded table structure over the typed canonical tree.
//
// Reads `w:tbl`/`w:tr`/`w:tc` into the bounded structure consumed by table layout. All widths
// leave in POINTS, matching `geometryOfSection` and `paragraphIndent`.
//
// Every value is attacker-controlled. Clamp before allocation, and never spread or pass an
// attacker-sized collection as varargs: either can trigger unbounded allocation or arity failure.
//
// Width reconciliation lives in `table-widths.ts`: settling one column depends on every cell
// covering it across every row, not any one node visited here.
import {
  flattenContentControls,
  healedTableView,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import {
  readFlag,
  readGridSkip,
  readGridSpan,
  readRowHeight,
  exactRowHeightWithBottomMargin,
  readVMerge,
} from './table-row-properties.ts';
import { readTableFloatPosition, type TableFloatPosition } from './table-float-properties.ts';
export type {
  TableFloatAnchor,
  TableFloatPosition,
  TableFloatXSpec,
  TableFloatYSpec,
} from './table-float-properties.ts';
import {
  revisionNodeIncluded,
  revisionNodeProjectionMode,
  type RevisionAttribution,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import { mergedFlowBlocks } from './story-roots.ts';
import {
  EMPTY_TABLE_CELL_STYLE_FORMATTING,
  EMPTY_TABLE_FORMATTING,
  cascadeTableFormatting,
  tableStyleAffectsCells,
  tableCellStyleFormatting,
  type StyleCascadeTable,
  type TableCellStyleFormatting,
} from './style-cascade.ts';
import {
  mergeCellBorders,
  mergeCellDiagonalBorders,
  mergeTableBorders,
} from './table-border-cascade.ts';
import {
  EMPTY_CELL_BORDER_BOX,
  EMPTY_TABLE_BORDER_BOX,
  readCellBorders,
  readTableBorders,
  rowExceptionBorders,
  type CellBorderBox,
  type TableBorderBox,
} from './table-borders.ts';
import {
  AUTO_PREFERRED_WIDTH,
  MAX_TABLE_COLUMNS,
  gridColumnElements,
  preferredLengthPt,
  readPreferredWidth,
  readTableIndentPt,
  readTablePreferredWidth,
  resolveColumnWidthsPt,
  tableWidthPastTextColumn,
  type CellWidthClaim,
  type PreferredWidth,
} from './table-widths.ts';
import {
  CELL_PAD,
  DEFAULT_CELL_MARGINS,
  MAX_CELL_MARGIN_PT,
  mergeMargins,
  raiseRowTopMargins,
  readMarginSides,
  rowExceptionMargins,
  type CellMarginsPt,
} from './table-cell-margins.ts';
import { readCellTextDirection } from './table-cell-text-direction.ts';
import { readCellVerticalAlign, type CellVerticalAlign } from './table-cell-vertical-align.ts';
import { tableRowIsHeader } from './table-row-header-style.ts';
import { cellIgnoresEndMark, cellNoWrap } from './table-cell-hide-mark.ts';
import { uniformRowCellSpacingPt } from './table-row-cell-spacing.ts';
import { modernSharedPercentWidth, resolveTableWidthPlacement } from './table-width-placement.ts';
import { legacyFixedTableContentOffset } from './legacy-fixed-table-content.ts';
import { rowExceptionAlignment, withLegacyRowPlacement } from './legacy-row-placement.ts';
import { withLegacyTableSideRules } from './legacy-table-side-rules.ts';
import {
  conditionalTypesFor,
  headerBlockRowCount,
  readTableLook,
  rowConditionTypes,
} from './table-conditional-formats.ts';
import { cellShading } from './table-cell-shading.ts';
import { withRowSpacingShading } from './table-spacing-shading.ts';
import type { TableSpacingFrame, TableSpacingShading } from './semantic-records.ts';
import {
  wmlAttributeValue as attributeValue,
  wmlChildNamed as childNamed,
} from '../store/store/tree-op-table-shared.ts';
import {
  autofitColumnWidthsPt,
  narrowNestedReader,
  type TableAutofitContext,
} from './table-autofit-widths.ts';
export { tableOriginX, tableFloatOriginX } from './table-origin.ts';
// Cell padding is its own unit (`table-cell-margins.ts`); re-exported here because this is
// where the published table surface lives.
export {
  CELL_PAD,
  DEFAULT_CELL_MARGINS,
  MAX_CELL_MARGIN_PT,
  mergeMargins,
  readMarginSides,
  type CellMarginsPt,
};

export {
  AUTO_PREFERRED_WIDTH,
  MAX_TABLE_COLUMNS,
  type PreferredWidth,
  type PreferredWidthType,
} from './table-widths.ts';
export type { CellVerticalAlign } from './table-cell-vertical-align.ts';

/**
 * Layout-time nesting ceiling. Parse-time depth (MAX_DEPTH = 256 XML levels) alone still
 * admits ~80 levels of `w:tbl` recursion into the layout walk; deeper tables render as an
 * empty cell box rather than recursing.
 */
export const MAX_TABLE_NESTING = 16;

/**
 * Soft ceiling on an authored `w:trHeight` (~22"). Hostile `w:val` otherwise becomes a
 * multi-page row that every pagination preflight and cell box inherits.
 */
export const MAX_TABLE_ROW_HEIGHT_PT = 31_680 / 20;

/**
 * `w:trPr/w:trHeight` (17.4.81) resolved for layout. Points leave the reader already —
 * twips convert once here, matching every other table geometry boundary.
 *
 * Word quirk (matches Form025U and Word's UI export): a present `@w:val` with an omitted
 * `@w:hRule` is treated as `atLeast`, not ECMA's `auto`. Explicit `auto` still ignores val.
 */
export type TableRowHeightRule = 'auto' | 'atLeast' | 'exact';

/**
 * `w:trHeight` — a row's height rule and its value.
 *
 * `auto` carries no value at all, which is why this is a union rather than a rule plus an
 * optional number.
 */
export type TableRowHeight =
  { readonly rule: 'auto' } | { readonly rule: 'atLeast' | 'exact'; readonly valuePt: number };

/** Highest grid column a cell may start on; keeps a row's total span bounded. */
const LAST_GRID_COLUMN = MAX_TABLE_COLUMNS - 1;

/** Bound conditional cell formatting per immutable resolved table style. */
const MAX_CELL_CONDITION_SETS = 256;
const cellStyleFormattingMemos = new WeakMap<object, Map<string, TableCellStyleFormatting>>();

/** `w:tblPr/w:jc` (17.4.29, ST_JcTable): where the table sits within the text column. */
export type TableAlignment = 'left' | 'center' | 'right';

/**
 * Bound on the size of `w:tblInd` in either direction. The indent is signed and has its own
 * reader (`readTableIndentPt`); the table widths and margins stay unsigned.
 */
const MAX_TABLE_INDENT_PT = 31_680 / 20;

/** One anchor box, in the same coordinates layout reports fragment boxes in. */
export interface TableAnchorFrame {
  readonly left: number;
  readonly width: number;
}

/** The three boxes `w:horzAnchor` can name, resolved for the region being laid out. */
export interface TableAnchorFrames {
  /** The text column the table was authored in. */
  readonly text: TableAnchorFrame;
  /** The page's text area between the left and right margins. */
  readonly margin: TableAnchorFrame;
  /** The whole sheet, margins included. */
  readonly page: TableAnchorFrame;
}

/**
 * One cell in the resolved table structure.
 *
 * `gridSpan` is clamped at READ time and layout never re-derives it — the value comes from a file
 * and would otherwise be a loop bound an attacker controls.
 */
export interface SemanticTableCell {
  readonly revisionShading?: 'inserted' | 'deleted' | 'merged' | 'split';
  readonly revisionShadingAuthor?: string;
  readonly id: string;
  /** Derived content-edge geometry for a verified legacy percentage-width parent table. */
  readonly legacyContentAlignment?: true;
  /** Resolved simple side rules centered on a legacy absolute-width table grid. */
  readonly centeredSideRules?: true;
  /** Simple side rules painted centered on the grid line, without moving the content edge. */
  readonly centeredSidePaint?: true;
  /** Clamped to [1, MAX_TABLE_COLUMNS] at read time; layout never re-derives it. */
  readonly gridSpan: number;
  /** Physical grid column after width/style resolution and the bidiVisual projection. */
  readonly gridColumn: number;
  /** Stored grid index when bidiVisual maps this cell into a physical RTL grid. */
  readonly logicalGridColumn?: number;
  /** Canonical `w:gridCol` node id for this cell's start column, when the grid is authored. */
  readonly gridColumnId?: string;
  /** A vMerge cell that is not the restart continues the cell above: box, no content. */
  readonly vMergeContinue: boolean;
  /** This cell starts a vertical merge that the next row continues. */
  readonly headsVerticalMerge?: true;
  /** `w:hideMark` excludes the end-of-cell glyph from row sizing. */
  readonly hideEndMark?: boolean;
  /** `w:noWrap`: autofit never narrows the cell's column below its preferred width. */
  readonly noWrap?: true;
  /** `w:vAlign` — defaults to top when omitted/unrecognised. */
  readonly vAlign: CellVerticalAlign;
  /** `w:textDirection`; unsupported values keep horizontal layout. */
  readonly textDirection: 'horizontal' | 'btLr';
  /** Resolved per-side margins (tcMar over tblCellMar over the table style over Word's default). */
  readonly margins: CellMarginsPt;
  /** Three-state authored `tcBorders` (omitted / none / edge). */
  readonly borders: CellBorderBox;
  /** The row's `w:tblPrEx` table borders, which replace the table's own for this cell. */
  readonly rowTableBorders?: TableBorderBox;
  /** Resolved incident edges used for content clearance, preserving authored border provenance. */
  readonly contentBorders?: CellBorderBox;
  /** The resolved cell (including a vertical merge) ends at the authored table bottom. */
  readonly contentBottomIsOuter?: boolean;
  /** Clearance this AUTHORED ROW reserves above its content for its own top rule, in points. */
  readonly topBandClearancePt?: number;
  /** Row-local clearance in points for authored minima, before vMerge combines content boxes. */
  readonly minimumContentInsets?: { readonly top: number; readonly bottom: number };
  /** Validated 6-hex shading fill, absent for none/auto. */
  readonly shading?: string;
  /**
   * `w:tcW` — the width this cell asked for, as authored.
   *
   * Published for consumers that need the cell's own statement (a column-resize handle has
   * to write back to it). Column geometry is NOT derived from this field: the resolver works
   * from a flat claim list built in the same pass, because resolving a column means looking
   * at every cell that covers it across every row, not at one cell at a time. Read
   * `columnWidthsPt` for what the table actually laid out.
   */
  readonly preferredWidth: PreferredWidth;
  /**
   * What the table style says about this cell's paragraphs and runs (17.7.6.6) — a header
   * row's bold and centring live here, not in the cell's own properties.
   */
  readonly styleFormatting: TableCellStyleFormatting;
  /** Block children in reading order, with content-control wrappers flattened. */
  readonly blocks: readonly OoxmlElement[];
}

/** One row in the resolved structure: its cells, its height rule, and any row-level revision. */
export interface SemanticTableRow {
  readonly id: string;
  /** Pending Word row insertion/deletion authored in `w:trPr`. */
  readonly revisionKind?: 'insert' | 'delete';
  /**
   * The `w:trPr/w:ins|w:del` attribution, carried with the kind so a painted row can say
   * WHOSE pending decision it is — the review model addresses the decision by exactly this
   * `(id, author, date)` triple, and a surface with only the kind could highlight the row
   * but never open its card.
   */
  readonly revisionId?: string;
  readonly revisionAuthor?: string;
  readonly revisionDate?: string;
  /** The row insertion a resolved view kept the row through; see the fragment record. */
  readonly changeSites?: readonly RevisionAttribution[];
  /** `w:trPr/w:tblHeader` — the row repeats atop each page the table continues onto. */
  readonly isHeader: boolean;
  /**
   * `w:trPr/w:cantSplit` — the row must stay on one page. When no page can hold it, the
   * row starts on a fresh page and splits there, so its content is kept.
   */
  readonly cantSplit: boolean;
  /** `w:trPr/w:trHeight` — auto / atLeast floor / exact row height plus bottom cell margin. */
  readonly height: TableRowHeight;
  readonly cells: readonly SemanticTableCell[];
  /** The table's fill (its style, `w:tblPr`, then this row's `w:tblPrEx`) in spaced gaps. */
  readonly spacingShading?: TableSpacingShading;
  /** How far a spaced table's frame moves this row's cells in (`table-spacing-frame.ts`). */
  readonly spacingFrame?: TableSpacingFrame; /** `w:tblPrEx/w:jc` (17.4.61, 17.4.28): the row's own alignment. */
  readonly alignment?: TableAlignment;
  /** Derived, never serialized: how far a legacy table moves this row right of its grid. */
  readonly xShiftPt?: number;
}

/**
 * A table resolved into a rectangular grid: column widths, rows, and the widths it asked for.
 *
 * The grid is normalized here so layout never has to reconcile `w:gridCol` against actual cell
 * spans — vertical merges and column spans are already accounted for.
 */
export interface SemanticTableStructure {
  /** Whether stored columns and horizontal table properties display right to left. */
  readonly bidiVisual?: true;
  readonly columnWidthsPt: readonly number[];
  /** Cell widths before the table width fitted them, when it did (`resolveColumnWidthsPt`). */
  readonly statedColumnWidthsPt?: readonly number[];
  readonly rows: readonly SemanticTableRow[];
  /** Verified pre-2013 percentage-width inline table; derived, never serialized. */
  readonly legacyContentAlignment?: true;
  /** A legacy content-aligned table whose outer trailing edge, not its content, meets the
   * trailing text edge: a top-level table in a text box. Derived, never serialized. */
  readonly legacyTrailingOuterEdge?: true;
  /**
   * Derived, never serialized: how far the grid moves from the aligned table edge, in points.
   * A supported legacy table with an absolute width shifts by its aligned cell margin so its
   * content meets the aligned text edge (`legacyContentOffsetPt`).
   * A compatibility-mode-15 left- or right-aligned table puts the outer edge of its side rule
   * on that edge, so its first grid line sits half a rule inward. Positive moves right.
   */
  readonly outerRuleOffsetPt?: number;
  /**
   * Derived, never serialized: the legacy content-edge offset, which `outerRuleOffsetPt`
   * carries. It does not depend on the column widths, so AutoFit widening keeps it.
   */
  readonly legacyContentOffsetPt?: number;
  /**
   * Derived, never serialized: the outer side rule an automatic-width mode-15 AutoFit table
   * keeps inside its container, so its grid settles that much narrower than the room.
   */
  readonly autoOuterRulePt?: number;
  /** Derived, never serialized: a right-to-left text-box table's move right, in points. */
  readonly textBoxBidiShiftPt?: number;
  /** Derived, never serialized: a top-level table of a text box story. */
  readonly textBox?: true;
  /** Derived, never serialized: AutoFit widening keeps the shared grid lines. */
  readonly sharedGridLinesHold?: true;
  /**
   * Derived, never serialized: a top-level autofit table whose absolute `w:tblW` is wider than
   * its text column. See `tableWidthPastTextColumn`.
   */
  readonly pastTextColumn?: true;
  /** `w:tblPr/w:tblW` — the width the table asked for. */
  readonly tableWidth: PreferredWidth;
  /**
   * `w:tblInd` (17.4.50) in points — "this indentation should shift the table into the text
   * margin by the specified amount". Applies to a left-aligned table; `w:jc` decides the
   * placement outright for the other two. Negative on a top-level table, which the indent
   * pulls into the leading margin; never negative on a nested table.
   */
  readonly indentPt: number;
  /** `w:tblPr/w:jc` (17.4.29) — where the table sits in the text column. */
  readonly alignment: TableAlignment;
  /**
   * `w:tblPr/w:tblpPr` (17.4.57) — present when the table is positioned against an anchor
   * box. Placement then comes from {@link tableFloatOriginX} rather than `w:jc`/`w:tblInd`.
   */
  readonly float?: TableFloatPosition;
  /**
   * `w:tblCellSpacing` (17.4.45) in points: the space on each side of every cell. Cells sit
   * twice this apart and from the table edge; the gaps come out of the table width, and each
   * column gives up its share in proportion (`table-cell-spacing.ts`). Each row opens the
   * same gap above its cells, and the outer borders frame it all (`table-spacing-frame.ts`).
   */
  readonly cellSpacingPt: number;
  /**
   * `w:tblPr/w:tblLayout/@w:type="fixed"` (17.4.52 — 17.4.53 is the `w:tblPrEx` exception
   * variant, not this element). Fixed layout takes the grid as final;
   * anything else is autofit, which in Word never renders wider than the text column.
   */
  readonly layoutFixed: boolean;
  /** Table-level `tblBorders` (three-state, including insideH/insideV). */
  readonly tableBorders: TableBorderBox;
  /** Table-level `tblCellMar` defaults (per-side, Word's own default when a side is omitted). */
  readonly defaultMargins: CellMarginsPt;
}

/**
 * Read one typed table node into a bounded structure, or null when the node is not a
 * typed table or sits beyond the nesting ceiling.
 */
export function readTableStructure(
  table: OoxmlNode,
  contentWidthPt: number,
  depth: number,
  styleCascade?: StyleCascadeTable,
  /** Which revisions the view resolves away; only the proposed result performs the join. */
  displayMode: RevisionDisplayMode = 'all-markup',
  authorFilter?: RevisionAuthorFilter,
  compatibilityMode?: number,
  /** Widens autofit columns to their content minimums; layout passes its measurer. */
  autofit?: TableAutofitContext,
  /** The table is a top-level table of a text box story. */
  textBox = false
): SemanticTableStructure | null {
  const base = cachedTableStructure(
    table,
    {
      contentWidthPt,
      depth,
      styleCascade,
      displayMode,
      authorFilter,
      compatibilityMode,
      textBox,
    },
    () =>
      readTableStructureUncached(
        table,
        contentWidthPt,
        depth,
        styleCascade,
        displayMode,
        authorFilter,
        compatibilityMode,
        textBox
      )
  );
  if (!autofit || !base || (base.layoutFixed && depth === 0)) return base;
  const context = { compatibilityMode, depth, contentWidthPt };
  const nested = nestedAutofitStructure(base, autofit, context);
  if (nested) return nested;
  // Deleted and inserted content sizes the columns in every view.
  const markupStructure =
    displayMode === 'all-markup' || !tableHasHidableRevisions(table)
      ? undefined
      : readTableStructure(
          table,
          contentWidthPt,
          depth,
          styleCascade,
          'all-markup',
          authorFilter,
          compatibilityMode,
          undefined,
          textBox
        );
  // Most tables already hold their content: they come back as the shared base structure.
  const widths = autofitColumnWidthsPt(base, contentWidthPt, autofit, {
    styleCascade,
    displayMode,
    authorFilter,
    depth,
    ...(markupStructure ? { markupStructure } : {}),
    readNested: narrowNestedReader(
      readTableStructure,
      styleCascade,
      displayMode,
      authorFilter,
      compatibilityMode
    ),
  });
  if (widths === base.columnWidthsPt) return base;
  return widenedTableStructure(base, widths, { compatibilityMode, depth, contentWidthPt });
}

function readTableStructureUncached(
  source: OoxmlNode,
  contentWidthPt: number,
  depth: number,
  styleCascade: StyleCascadeTable | undefined,
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter,
  compatibilityMode?: number,
  textBox = false
): SemanticTableStructure | null {
  if (depth >= MAX_TABLE_NESTING) return null;
  if (source.kind !== 'table') return null;
  const table = healedTableView(source); // Repeated row/cell containers show as a save merges them.

  const tblPr = childNamed(table, 'tblPr');
  // A table's appearance mostly lives in its STYLE. Word writes
  // `<w:tblStyle w:val="TableGrid"/>` and keeps the grid in styles.xml, so reading the
  // table's own `w:tblPr` alone draws a borderless table where Word draws a full grid.
  const styleId =
    tblPr && childNamed(tblPr, 'tblStyle')
      ? attributeValue(childNamed(tblPr, 'tblStyle')!, 'val')
      : undefined;
  const tableStyle = styleCascade
    ? cascadeTableFormatting(styleCascade, styleId)
    : EMPTY_TABLE_FORMATTING;
  const look = readTableLook(tblPr);
  let bidiVisual = false;
  for (const node of tableStyle.tablePropertyNodes) {
    if (childNamed(node, 'bidiVisual')) bidiVisual = readFlag(node, 'bidiVisual');
  }
  if (tblPr && childNamed(tblPr, 'bidiVisual')) bidiVisual = readFlag(tblPr, 'bidiVisual');

  // A missing margin resolves to 10 twips, including legacy documents. The
  // familiar 108-twip inset belongs to the authored default table style, not
  // this application fallback. Styles, table properties and cells override
  // each side independently, including explicit zero.
  let styleMargins: CellMarginsPt = { top: 0, right: 0.5, bottom: 0, left: 0.5 };
  let styleBorders = EMPTY_TABLE_BORDER_BOX;
  for (const node of tableStyle.tablePropertyNodes) {
    styleMargins = mergeMargins(styleMargins, readMarginSides(childNamed(node, 'tblCellMar')));
    styleBorders = mergeTableBorders(styleBorders, readTableBorders(node));
  }
  const defaultMargins = mergeMargins(
    styleMargins,
    readMarginSides(tblPr && childNamed(tblPr, 'tblCellMar'))
  );
  const tableBorders = mergeTableBorders(
    styleBorders,
    tblPr ? readTableBorders(tblPr) : EMPTY_TABLE_BORDER_BOX
  );

  // The same immutable style and conditions apply across tables and width variants.
  // Bound the shared memo so hostile condition combinations do not grow it indefinitely.
  let styleByConditions = cellStyleFormattingMemos.get(tableStyle);
  if (!styleByConditions) cellStyleFormattingMemos.set(tableStyle, (styleByConditions = new Map()));
  // Word's `TableNormal` states `w:tblPr` and nothing else, and every table now resolves it,
  // so the identity check against `EMPTY_TABLE_FORMATTING` that used to short-circuit here
  // stopped firing — every cell of every unstyled table flattened a chain that could only
  // ever answer "nothing". Ask what the style actually contributes to a CELL instead.
  const cellStyleMaterial = tableStyleAffectsCells(tableStyle);
  const styleFormattingFor = (conditions: readonly string[]): TableCellStyleFormatting => {
    if (!cellStyleMaterial) return EMPTY_TABLE_CELL_STYLE_FORMATTING;
    const key = conditions.join('|');
    const cached = styleByConditions.get(key);
    if (cached) return cached;
    const resolved = tableCellStyleFormatting(tableStyle, conditions);
    if (styleByConditions.size < MAX_CELL_CONDITION_SETS) styleByConditions.set(key, resolved);
    return resolved;
  };

  // Grid pass. Every cell's absolute grid column, and the table's column count, are settled
  // before any conditional format is derived — both key on the grid, not on cell order. A
  // cell may start no later than the last column and may not span past it, which is what
  // bounds a ROW's total span: per-cell `w:gridSpan` is already clamped, but a row of
  // thousands of maximum-span cells would otherwise walk millions of grid intervals in the
  // border pass. Fails closed like the ownership and vMerge budgets: the overflow cells
  // pile onto the last column instead of extending the grid.
  interface RowPlan {
    readonly node: OoxmlElement;
    readonly revision: OoxmlElement | undefined;
    readonly changeSites: readonly RevisionAttribution[] | undefined;
    /** The row's cells with any `CT_SdtCell` wrapper unwrapped, so both passes see one list. */
    readonly cells: readonly OoxmlNode[];
    readonly properties: OoxmlElement | undefined;
    readonly starts: readonly number[];
    readonly spans: readonly number[];
    readonly preferred: readonly PreferredWidth[];
    readonly gridColumns: number;
  }
  const plans: RowPlan[] = [];
  const claims: CellWidthClaim[] = [];
  let hasOmittedRows = false;
  let derivedColumns = 1;
  let cellEnd = 0;
  // A content control may sit between the table and its rows (`CT_SdtRow`) or between a row and
  // its cells (`CT_SdtCell`). It is a label on that row or cell, not a box around it, so it is
  // unwrapped HERE — before the kind filter — and the grid pass, the cell pass and pagination all
  // see the same row and cell lists they would see in a table that carried no controls at all.
  for (const rowNode of flattenContentControls(table.children)) {
    if (rowNode.kind !== 'tableRow') continue;
    const properties = wmlRevisionChild(rowNode, 'trPr');
    const authoredRevision = properties
      ? (wmlRevisionChild(properties, 'ins') ?? wmlRevisionChild(properties, 'del'))
      : undefined;
    const revisionKind = authoredRevision?.localName;
    const revisionAuthor = authoredRevision
      ? (wmlRevisionAttribute(authoredRevision, 'author') ?? '')
      : undefined;
    const projectedMode =
      authoredRevision && revisionAuthor !== undefined && authorFilter
        ? revisionNodeProjectionMode(authorFilter, authoredRevision.id, revisionAuthor, displayMode)
        : displayMode;
    if (
      (projectedMode === 'proposed' && revisionKind === 'del') ||
      (projectedMode === 'original' && revisionKind === 'ins') ||
      hiddenRowCollapses(rowNode, properties, projectedMode, authorFilter)
    ) {
      hasOmittedRows = true;
      continue;
    }
    const revision = projectedMode === 'all-markup' ? authoredRevision : undefined;
    // A resolved view that KEEPS a tracked row (an accepted insertion) still owes the reader
    // a change bar beside it, unless the reviewer filter hides the decision.
    const changeSites =
      authoredRevision &&
      projectedMode !== 'all-markup' &&
      revisionAuthor !== undefined &&
      (!authorFilter || revisionNodeIncluded(authorFilter, authoredRevision.id, revisionAuthor))
        ? [
            {
              kind: revisionKind === 'ins' ? ('insert' as const) : ('delete' as const),
              id: wmlRevisionAttribute(authoredRevision, 'id') ?? '',
              author: revisionAuthor,
              ...(wmlRevisionAttribute(authoredRevision, 'date') === undefined
                ? {}
                : { date: wmlRevisionAttribute(authoredRevision, 'date')! }),
              nodeId: authoredRevision.id,
            },
          ]
        : undefined;
    const starts: number[] = [];
    const spans: number[] = [];
    const preferred: PreferredWidth[] = [];
    const gridBefore = Math.min(readGridSkip(properties, 'gridBefore'), LAST_GRID_COLUMN);
    // 17.18.87: "the initial number of grid units before the row starts is skipped. The
    // width of the skipped grid columns is set using the wBefore property." Without this the
    // skipped band is a column nothing states, and it absorbs the leftover as a phantom
    // gutter wider than the cells it precedes.
    if (gridBefore > 0) {
      claims.push({
        start: 0,
        span: gridBefore,
        preferred: readPreferredWidth(properties && childNamed(properties, 'wBefore')),
      });
    }
    let cursor = gridBefore;
    const rowCells = flattenContentControls(rowNode.children);
    for (const cellNode of rowCells) {
      if (cellNode.kind !== 'tableCell') continue;
      const cellPr = childNamed(cellNode, 'tcPr');
      const start = Math.min(cursor, LAST_GRID_COLUMN);
      const span = Math.min(
        readGridSpan(cellPr),
        MAX_TABLE_COLUMNS - start // ≥ 1: `start` never exceeds the last column
      );
      const width = readPreferredWidth(cellPr && childNamed(cellPr, 'tcW'));
      starts.push(start);
      spans.push(span);
      preferred.push(width);
      claims.push({ start, span, preferred: width });
      cursor = start + span;
    }
    const gridAfter = readGridSkip(properties, 'gridAfter');
    const gridColumns = Math.min(cursor + gridAfter, MAX_TABLE_COLUMNS);
    // 17.4.85, the trailing counterpart of `w:wBefore`.
    if (gridAfter > 0 && cursor < MAX_TABLE_COLUMNS) {
      claims.push({
        start: cursor,
        span: Math.min(gridAfter, MAX_TABLE_COLUMNS - cursor),
        preferred: readPreferredWidth(properties && childNamed(properties, 'wAfter')),
      });
    }
    if (gridColumns > derivedColumns) derivedColumns = gridColumns;
    if (cursor > cellEnd) cellEnd = cursor;
    plans.push({
      node: rowNode,
      revision,
      changeSites,
      cells: rowCells,
      properties,
      starts,
      spans,
      preferred,
      gridColumns,
    });
  }

  const authoredGrid = gridColumnElements(table);
  const { lead, gridCols } = reachedGrid(authoredGrid, plans, claims, cellEnd, hasOmittedRows);
  const columnCount = gridCols.length > 0 ? gridCols.length : derivedColumns - lead;
  // Table style conditions, such as the last column, count the authored grid.
  const styleColumns = authoredGrid.length > 0 ? authoredGrid.length : derivedColumns;
  const bodyRows = plans.length;

  const rows: SemanticTableRow[] = [];
  // Grid columns where the previous row has a cell with `w:vMerge`. A continuation only
  // continues such a cell (17.4.85). Below an unmerged cell, or in the first row, it has
  // nothing to continue, so it starts its own merge and paints its own content.
  let mergedAbove = new Set<number>();
  let cellsAbove: SemanticTableCell[] = [];
  const rowConditionsFor = (rowIndex: number, headerRows: number): readonly string[] =>
    rowConditionTypes(look, rowIndex, bodyRows, headerRows, styleColumns);
  // A row's own repeat flag is read with only row 0 as the header row.
  const headerRows = headerBlockRowCount(look, bodyRows, (rowIndex) =>
    tableRowIsHeader(
      tableStyle,
      rowConditionsFor(rowIndex, look.firstRow ? 1 : 0),
      plans[rowIndex]!.properties
    )
  );
  for (let rowIndex = 0; rowIndex < plans.length; rowIndex += 1) {
    const plan = plans[rowIndex]!;
    const rowNode = plan.node;
    const rowProperties = plan.properties;
    const rowConditions = rowConditionsFor(rowIndex, headerRows);
    const isHeader = tableRowIsHeader(tableStyle, rowConditions, rowProperties);
    const rowTableBorders = rowExceptionBorders(rowNode, tableBorders);
    const rowMargins = rowExceptionMargins(rowNode, defaultMargins);
    let cellIndex = 0;
    const cells: SemanticTableCell[] = [];
    const mergedHere = new Set<number>();
    for (const cellNode of plan.cells) {
      if (cellNode.kind !== 'tableCell') continue;
      const cellProperties = childNamed(cellNode, 'tcPr');
      const gridColumn = plan.starts[cellIndex]!;
      const gridSpan = plan.spans[cellIndex]!;
      // Read alongside its siblings, before `cellIndex` moves on — the plan loop and this
      // one skip the same non-cell children, and the indices must stay in lockstep.
      const preferredWidth = plan.preferred[cellIndex] ?? AUTO_PREFERRED_WIDTH;
      const conditions = conditionalTypesFor({
        look,
        rowIndex,
        rowCount: bodyRows,
        headerRows,
        gridColumn: gridColumn + lead,
        gridSpan,
        columnCount: styleColumns,
      });
      cellIndex += 1;
      let conditionalBorders = EMPTY_CELL_BORDER_BOX;
      // Whole-table tcPr and basedOn layers contribute diagonals before conditions.
      for (const node of tableStyle.tableCellPropertyNodes ?? []) {
        conditionalBorders = mergeCellDiagonalBorders(conditionalBorders, readCellBorders(node));
      }
      for (const conditionType of conditions) {
        const format = tableStyle.conditional.get(conditionType);
        if (!format) continue;
        const conditionTcPr = childNamed(format, 'tcPr');
        conditionalBorders = mergeCellBorders(
          conditionalBorders,
          readConditionalCellBorders(
            conditionTcPr,
            tableStyle.conditionalStyleLayers?.get(conditionType)
          )
        );
      }
      const shading = cellShading(tableStyle, conditions, cellProperties);
      const cellMargins = mergeMargins(
        rowMargins,
        readMarginSides(cellProperties && childNamed(cellProperties, 'tcMar'))
      );
      // Content controls inside a cell flatten transparently — same rule as body
      // `storyBlocks`. Without this a `w:sdt` wrapping the cell's paragraphs leaves the
      // cell empty in layout while the tree still holds the text.
      // Through the shared collector: a cell is a story like any other, so a tracked mark
      // merges inside it and a paragraph a revision removed leaves no blank line behind.
      const blocks = mergedFlowBlocks(cellNode.children, displayMode, authorFilter);
      const ownBorders = cellProperties ? readCellBorders(cellProperties) : EMPTY_CELL_BORDER_BOX;
      const vMerge = readVMerge(cellProperties);
      if (vMerge !== 'none') mergedHere.add(gridColumn);
      if (vMerge === 'continue' && mergedAbove.has(gridColumn)) {
        const above = cellsAbove.findIndex((c) => c.gridColumn === gridColumn);
        const head = cellsAbove[above];
        if (head && !head.vMergeContinue && !head.headsVerticalMerge)
          cellsAbove[above] = { ...head, headsVerticalMerge: true };
      }
      cells.push({
        id: cellNode.id,
        ...revisionCellMetadata(cellProperties, displayMode, authorFilter, plan.revision),
        gridSpan,
        gridColumn,
        ...(gridCols[gridColumn]?.id ? { gridColumnId: gridCols[gridColumn]!.id } : {}),
        vMergeContinue: vMerge === 'continue' && mergedAbove.has(gridColumn),
        hideEndMark: cellIgnoresEndMark(tableStyle, conditions, cellProperties),
        ...(cellNoWrap(tableStyle, conditions, cellProperties) ? { noWrap: true as const } : {}),
        vAlign: readCellVerticalAlign(cellProperties),
        textDirection: readCellTextDirection(cellProperties),
        margins: cellMargins,
        borders: mergeCellBorders(conditionalBorders, ownBorders),
        ...(rowTableBorders ? { rowTableBorders } : {}),
        ...(shading === undefined ? {} : { shading }),
        preferredWidth,
        styleFormatting: styleFormattingFor(conditions),
        blocks,
      });
    }
    raiseRowTopMargins(cells);
    mergedAbove = mergedHere;
    cellsAbove = cells;
    const rowRevision = plan.revision;
    const rowRevisionKind = rowRevision
      ? rowRevision.localName === 'ins'
        ? ('insert' as const)
        : ('delete' as const)
      : undefined;
    const rowRevisionId = rowRevision && wmlRevisionAttribute(rowRevision, 'id');
    const rowRevisionAuthor = rowRevision && wmlRevisionAttribute(rowRevision, 'author');
    const rowRevisionDate = rowRevision && wmlRevisionAttribute(rowRevision, 'date');
    rows.push({
      id: rowNode.id,
      ...(rowRevisionKind ? { revisionKind: rowRevisionKind } : {}),
      ...(rowRevisionId !== undefined ? { revisionId: rowRevisionId } : {}),
      ...(rowRevisionAuthor !== undefined ? { revisionAuthor: rowRevisionAuthor } : {}),
      ...(rowRevisionDate !== undefined ? { revisionDate: rowRevisionDate } : {}),
      ...(plan.changeSites ? { changeSites: plan.changeSites } : {}),
      isHeader,
      cantSplit: readFlag(rowProperties, 'cantSplit'),
      ...rowExceptionAlignment(rowNode),
      height: exactRowHeightWithBottomMargin(readRowHeight(rowProperties), cells),
      cells,
    });
  }

  const style = readStyleTableProperties(tableStyle.tablePropertyNodes, {
    indentPt: MAX_TABLE_INDENT_PT,
    cellSpacingPt: MAX_CELL_MARGIN_PT,
  });
  const ownTblW = tblPr && childNamed(tblPr, 'tblW');
  const tableWidth = ownTblW ? readTablePreferredWidth(ownTblW) : style.tableWidth;
  const tblLayout = tblPr && childNamed(tblPr, 'tblLayout');
  const layoutFixed = tblLayout
    ? attributeValue(tblLayout, 'type') === 'fixed'
    : (style.layoutFixed ?? false);
  const indentNode = tableIndentNode(tblPr, plans[0]?.node);
  const statedIndentPt = readTableIndentPt(indentNode, MAX_TABLE_INDENT_PT) ?? style.indentPt ?? 0;
  // Captured controls pull a top-level table (bidiVisual too) into the leading margin by a
  // negative indent, and leave a nested table where a zero indent puts it.
  const readIndentPt = depth === 0 ? statedIndentPt : Math.max(0, statedIndentPt);
  const alignment =
    tableAlignmentOf(tblPr, plans[0]?.node, compatibilityMode) ?? style.alignment ?? 'left';
  // A nested table's `w:tblpPr` positions it against its cell, not the page; the cell flow
  // places it (`cell-float-tables.ts`), so its structure is read as an in-flow table.
  const float = depth === 0 ? (readTableFloatPosition(tblPr) ?? style.float) : undefined;
  const cellSpacingPt =
    preferredLengthPt(tblPr && childNamed(tblPr, 'tblCellSpacing'), MAX_CELL_MARGIN_PT) ??
    style.cellSpacingPt ??
    uniformRowCellSpacingPt(table) ??
    0;

  const placement = resolveTableWidthPlacement({
    table,
    propertyNodes: tableStyle.tablePropertyNodes,
    rows,
    columnCount,
    contentWidthPt,
    compatibilityMode,
    depth,
    tableWidth,
    cellSpacingPt,
    floating: float !== undefined,
    layoutFixed,
    alignment,
    bidiVisual,
    indentPt: readIndentPt,
    indentStated: Boolean(indentNode) || style.indentPt !== undefined,
    leadingSkipPt: leadingSkipPt(authoredGrid, lead),
    tableBorders,
    claims: claimsWithinGrid(claims, columnCount),
    gridCols,
    textBox,
  });
  const { legacy, indentPt } = placement;
  const legacyWidth = legacy?.widthPt;

  const pastTextColumn = tableWidthPastTextColumn({
    tableWidth: placement.tableWidth,
    textColumnPt: placement.contentWidthPt,
    layoutFixed,
    depth,
    textBox,
  });
  // Project the grid visually; cell arrays retain document order for keyboard traversal.
  const visualRows = physicalTableRows(rows, columnCount, bidiVisual);
  const visualBorders = bidiVisual
    ? { ...tableBorders, left: tableBorders.right, right: tableBorders.left }
    : tableBorders;
  const collapsed = cellSpacingPt === 0;
  let contentRows = withTableContentBorders(visualRows, visualBorders, columnCount, collapsed);
  contentRows = withRowMinimumContentInsets(
    contentRows,
    visualRows,
    visualBorders,
    columnCount,
    collapsed
  );
  const statedOut: { widths?: readonly number[] } = {};
  const resolveColumns = (width: PreferredWidth): readonly number[] =>
    resolveColumnWidthsPt({
      statedOut,
      gridCols,
      claims: placement.claims,
      columnCount,
      contentWidthPt: placement.contentWidthPt,
      tableWidth: width,
      layoutFixed,
      // A hidden revision row can still account for part of the authored grid.
      hasOmittedRows,
      minimumsPt: cellMarginMinimumsPt(rows, columnCount),
      spacing: spacingGapsBeforeColumns(
        contentRows,
        visualBorders,
        cellSpacingPt,
        columnCount,
        bidiVisual
      ),
    });
  let columnWidthsPt = resolveColumns(placement.tableWidth);
  // A mode-15 percentage table whose rules share its grid lines takes its share less the rule.
  const percentRulePt = modernPercentRulePt(contentRows, {
    ...{ compatibilityMode, depth, cellSpacingPt, widthType: tableWidth.type },
    ...{ floating: float !== undefined, columnCount: columnWidthsPt.length },
  });
  const structureWidth =
    percentRulePt === undefined
      ? tableWidth
      : modernSharedPercentWidth(tableWidth, placement.contentWidthPt, percentRulePt);
  if (structureWidth !== tableWidth) columnWidthsPt = resolveColumns(structureWidth);
  const sideRuleShape = {
    compatibilityMode,
    depth,
    bidiVisual,
    floating: float !== undefined,
    cellSpacingPt,
    widthType: tableWidth.type,
    ...(tableWidth.type === 'dxa' ? { statedWidthPt: tableWidth.value } : {}),
    alignment,
    layoutFixed,
    indentPt,
    columnWidthsPt,
    containerWidthPt: contentWidthPt,
    ...(textBox ? { textBox: true } : {}),
  };
  const sideRules = withSharedGridLineSideRules(contentRows, sideRuleShape);
  const contentOffset = legacyFixedTableContentOffset(
    table,
    tableStyle.tablePropertyNodes,
    contentRows,
    sideRuleShape,
    tableStyle !== EMPTY_TABLE_FORMATTING,
    visualBorders
  );
  contentRows =
    contentOffset !== undefined && tableWidth.type === 'auto' && cellSpacingPt === 0
      ? withLegacyTableSideRules(sideRules.rows)
      : sideRules.rows;
  const outerRuleOffsetPt = contentOffset ?? sideRules.outerRuleOffsetPt ?? placement.ruleShiftPt;
  const autoOuterRulePt =
    contentOffset === undefined ? autoWidthOuterRulePt(contentRows, sideRuleShape) : 0;
  const shadedRows = withRowSpacingShading(
    withSpacingFrame(contentRows, visualBorders, cellSpacingPt),
    {
      stylePropertyNodes: tableStyle.tablePropertyNodes,
      tableProperties: tblPr,
      rowNodeAt: (index) => plans[index]?.node,
      cellSpacingPt,
    }
  );
  return withLegacyRowPlacement(
    {
      ...(bidiVisual ? { bidiVisual: true as const } : {}),
      columnWidthsPt: bidiVisual ? [...columnWidthsPt].reverse() : columnWidthsPt,
      ...(statedOut.widths
        ? { statedColumnWidthsPt: visualOrder(statedOut.widths, bidiVisual) }
        : {}),
      rows:
        legacyWidth === undefined
          ? shadedRows
          : shadedRows.map((row) => ({
              ...row,
              cells: row.cells.map((cell) => ({ ...cell, legacyContentAlignment: true as const })),
            })),
      ...(legacyWidth === undefined ? {} : { legacyContentAlignment: true as const }),
      ...(legacy?.trailingOuterEdge ? { legacyTrailingOuterEdge: true as const } : {}),
      ...(outerRuleOffsetPt === undefined ? {} : { outerRuleOffsetPt }),
      ...(contentOffset === undefined ? {} : { legacyContentOffsetPt: contentOffset }),
      ...(autoOuterRulePt > 0 ? { autoOuterRulePt } : {}),
      ...(sideRules.holdsWhenWidened ? { sharedGridLinesHold: true as const } : {}),
      ...(placement.textBoxBidiShiftPt ? { textBoxBidiShiftPt: placement.textBoxBidiShiftPt } : {}),
      ...(textBox ? { textBox: true as const } : {}),
      ...(pastTextColumn ? { pastTextColumn: true as const } : {}),
      tableWidth: structureWidth,
      layoutFixed,
      indentPt,
      alignment: bidiVisual ? mirroredAlignment(alignment) : alignment,
      ...(float ? { float } : {}),
      cellSpacingPt,
      tableBorders: visualBorders,
      defaultMargins: bidiVisual
        ? { ...defaultMargins, left: defaultMargins.right, right: defaultMargins.left }
        : defaultMargins,
    },
    { compatibilityMode, depth, contentWidthPt }
  );
}
import { physicalTableRows, withTableContentBorders } from './table-content-borders.ts';
import { withSpacingFrame } from './table-spacing-frame.ts';
import { claimsWithinGrid, leadingSkipPt, reachedGrid } from './table-reached-grid.ts';
import { readStyleTableProperties } from './table-style-properties.ts';
import { cellMarginMinimumsPt, spacingGapsBeforeColumns, visualOrder } from './table-column-fit.ts';
