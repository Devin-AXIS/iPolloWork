import { numericLinesHoldAtWidth, numericWidthProofOf } from './numeric-width-proof-cache.ts';
// Moving an ordinary table row to new column widths without laying its cells out again.
//
// When AutoFit widths change, most rows hold one paragraph per cell, each a single line that
// still fits. Such a row keeps every vertical measurement: its line, spacing, insets and end
// mark do not depend on width. Only x and width change, and those come from the line the
// placement measured, aligned again by the same code a fresh placement runs.
//
// Placement records that measured line beside the paragraph fragment, keyed by the fragment's
// range object. That object is created once per placement and survives vertical shifts, row
// finalize and this reuse, so the record never outlives the fragments that share it.
//
// A cell reuses its line only when a fresh placement would take the same break:
// - the same paragraph node, layout inputs (apart from `available`), and break-key inputs
//   apart from width, so the break cache would answer from an entry with that line;
// - a line that holds at the new width under the break cache's own width-transfer rule, or
//   an empty line with no placement ties;
// - no list item, right-to-left text, page wrap zones, merges, or paragraph furniture that
//   is drawn from the line box (borders, shading, markers, mark revisions).
// Anything else returns null, and the row is laid out normally.

import {
  captureCellWidthPlacement,
  placeCellFromWidthRecipe,
  type CellWidthPlacement,
} from './table-cell-width-placement.ts';
import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import {
  cellAvailableWidth,
  cellParagraphBreakInputs,
  cellParagraphInputs,
  memoizedCellParagraphBreakInputs,
  memoizedCellParagraphInputs,
} from './cell-paragraph-inputs.ts';
import { cellBreakKeyPartsMatch, type CellBreakKeyParts } from './cell-break-key.ts';
import { alignCellLine } from './cell-line-alignment.ts';
import { rowsClearOutOfCellFloats } from './cell-anchor-layout.ts';
import { directionalListFirstLineShift } from './list-marker.ts';
import {
  LINE_HOLD_TOLERANCE_PT,
  lineTiedToPlacement,
  tokenLineHoldsAtWidth,
} from './paragraph-cache-width-reuse.ts';
import {
  lineContentX,
  pendingLineExclusionSkipAtPlacement,
  type PendingLine,
} from './pending-line.ts';
import type { SemanticTableRow } from './semantic-table.ts';
import { MIN_CELL_BOX_PT, sumCols, type TableFlowDeps } from './semantic-table-layout.ts';
import type { ParagraphLayoutInputs } from './style-cascade.ts';
import { sharedCellContentInsets } from './cell-content-insets-memo.ts';
import { cellFlowBox } from './table-cell-text-direction.ts';
import { cellReservedMarkHeights } from './table-cell-end-mark.ts';
import { authoredRowMinimumFloorPt } from './table-row-minimum-insets.ts';
import { shiftBlocks } from './table-fragment-finalize.ts';
import {
  cellAlignmentRoom,
  cellAlignmentShift,
  cellParagraphFirstTop,
} from './table-row-vertical.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  ParagraphFragmentRecord,
  TableCellFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';

interface CellLine {
  /** The break-cache key placement read its line from; the entry holds the line itself. */
  readonly key: string;
  readonly paragraph: OoxmlElement;
  readonly inputs: ParagraphLayoutInputs;
  readonly properties: readonly OoxmlProperty[];
  readonly parts: CellBreakKeyParts;
  /** Identities of the measurer, style cascade and author filter; see `identityOf`. */
  readonly measurer: number;
  readonly styleCascade: number;
  readonly compatibilityMode: TableFlowDeps['compatibilityMode'];
  readonly displayMode: TableFlowDeps['displayMode'];
  readonly revisionAuthorFilter: number;
  /** The vertical operands placement used; see `CellLineVertical`. */
  readonly vertical: CellLineVertical;
}

/**
 * The operands a complete, first-fragment cell paragraph placement added to its top, captured
 * where `placeCellParagraph` used them. None depends on where the row stands.
 */
export interface CellLineVertical {
  readonly appliedBefore: number;
  readonly topExtent: number;
  readonly appliedAfter: number;
}

/** Per row: the identities every cell of it compares, read once. */
interface MoveContext {
  readonly capture?: (recipe: CellWidthPlacement | null) => void;
  readonly deps: TableFlowDeps;
  readonly cache: NonNullable<TableFlowDeps['cache']>;
  readonly measurer: number;
  readonly styleCascade: number;
  readonly revisionAuthorFilter: number;
  readonly cols: readonly number[];
  readonly geometry: ColumnGeometry;
  readonly left: number;
}

let movedRowsObserver: { moved: number; fieldScans: number; compact: number } | null = null;

/**
 * @internal Counts rows moved without placement, and placed blocks a move had to scan for
 * unmovable fields, for tests that must see the reuse.
 */
export function movedRowsTestRecorder(): {
  readonly moved: number;
  readonly fieldScans: number;
  readonly compact: number;
  dispose(): void;
} {
  const observer = { moved: 0, fieldScans: 0, compact: 0 };
  movedRowsObserver = observer;
  return {
    get moved() {
      return observer.moved;
    },
    get fieldScans() {
      return observer.fieldScans;
    },
    get compact() {
      return observer.compact;
    },
    dispose() {
      if (movedRowsObserver === observer) movedRowsObserver = null;
    },
  };
}

/**
 * A number per measurer, style cascade or author filter object. A record compares these instead
 * of holding the objects: a measurer reaches its font caches and, through them, whatever a layout
 * pass left on the stack, so a record that outlives its layout must not keep one alive.
 */
const identities = new WeakMap<object, number>();
let nextIdentity = 1;
function identityOf(value: object | undefined): number {
  if (value === undefined) return 0;
  let known = identities.get(value);
  if (known === undefined) identities.set(value, (known = nextIdentity++));
  return known;
}

/** Keyed by a placed paragraph fragment's `range` object; see the module comment. */
const cellLines = new WeakMap<object, CellLine>();

/** Paragraph fragment fields that do not depend on the line box's x or width. */
const MOVABLE_FIELDS = new Set([
  'kind',
  'id',
  'paragraphEnd',
  'paragraphId',
  'fragmentIndex',
  'range',
  'props',
  'styleId',
  'outlineLevel',
  'alignment',
  'spacing',
  'indent',
  'tabStops',
  'lines',
  'emptyParagraphStyle',
  'paragraphMarkSizePt',
  'box',
]);

/** True when `line` gives the same break at `available` as wherever it was measured. */
function lineHolds(line: PendingLine, available: number): boolean {
  if (line.spans.length > 0) return tokenLineHoldsAtWidth(line, available);
  return (
    !lineTiedToPlacement(line) &&
    line.width + Math.max(0, line.firstLineOffset ?? 0) <= available + LINE_HOLD_TOLERANCE_PT
  );
}

/**
 * Record the break-cache entry a complete width-reusable cell paragraph was placed from. Called
 * by cell placement only for a paragraph that starts on this fragment, outside page wrap
 * zones, with no list item and left-to-right text. Nothing is recorded without a cache.
 */
export function rememberCellLine(
  fragment: ParagraphFragmentRecord,
  paragraph: OoxmlElement,
  lines: readonly PendingLine[],
  inputs: ParagraphLayoutInputs,
  properties: readonly OoxmlProperty[],
  parts: CellBreakKeyParts,
  deps: TableFlowDeps,
  key: string | undefined,
  vertical: CellLineVertical
): void {
  if (
    key === undefined ||
    !deps.cache ||
    !lines.length ||
    (lines.length !== 1 && !numericWidthProofOf(lines))
  )
    return;
  if (
    fragment.lines.length !== lines.length ||
    !fragment.lines.every((line, index) => placedFrom(line, lines[index]!))
  )
    return;
  if (!onlyMovableFields(fragment)) return;
  // The first move after a full layout reads this very fragment; its keys never change.
  movableBlocks.add(fragment);
  cellLines.set(fragment.range, {
    key,
    paragraph,
    inputs,
    properties,
    parts,
    measurer: identityOf(deps.measurer),
    styleCascade: identityOf(deps.styleCascade),
    compatibilityMode: deps.compatibilityMode,
    displayMode: deps.displayMode,
    revisionAuthorFilter: identityOf(deps.revisionAuthorFilter),
    vertical,
  });
}

/** `line` was placed whole from `pending`: no merge remap, no collapse, no placement ties. */
function placedFrom(line: LineRecord, pending: PendingLine): boolean {
  return (
    line.range.start === pending.start &&
    line.range.end === pending.end &&
    line.box.height === pending.height &&
    !lineTiedToPlacement(pending)
  );
}

function sameProperties(a: readonly OoxmlProperty[], b: readonly OoxmlProperty[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index]!;
    const y = b[index]!;
    if (x === y) continue;
    if (x.localName !== y.localName) return false;
    const left = x.attributes;
    const right = y.attributes;
    if (left === right) continue;
    if (!left || !right) return false;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    for (const key of keys) if (left[key] !== right[key]) return false;
  }
  return true;
}

function sameInputsExceptWidth(a: ParagraphLayoutInputs, b: ParagraphLayoutInputs): boolean {
  if (a === b) return true;
  // Key loops without key arrays: this runs for every moved cell.
  let count = 0;
  for (const key in a) {
    count += 1;
    if (
      key !== 'available' &&
      a[key as keyof ParagraphLayoutInputs] !== b[key as keyof ParagraphLayoutInputs]
    )
      return false;
  }
  for (const _key in b) count -= 1;
  return count === 0;
}

function onlyMovableFields(block: ParagraphFragmentRecord): boolean {
  if (movableBlocks.has(block)) return true;
  for (const field in block) if (!MOVABLE_FIELDS.has(field)) return false;
  return true;
}

/**
 * Blocks known to hold only movable fields: fragments `rememberCellLine` checked, and blocks
 * built from one with the same keys (`withLines`, a move). Records are never mutated, so the
 * answer holds for the object; any other copy, such as a vertical shift, is checked again.
 */
const movableBlocks = new WeakSet<ParagraphFragmentRecord>();

/**
 * Check a derived copy while placement still owns it, when its source was movable.
 * The copy is checked independently: added paragraph furniture must still refuse reuse.
 * This avoids repeating the check when a later width change reads the placed copy.
 */
export function rememberMovableCopy(
  source: ParagraphFragmentRecord,
  copy: ParagraphFragmentRecord
): ParagraphFragmentRecord {
  if (movableBlocks.has(source) && onlyMovableFields(copy)) movableBlocks.add(copy);
  return copy;
}

/**
 * `block` with new `lines`, keeping what is known about its fields. Every paragraph fragment
 * owns `lines`, so the copy has exactly the keys of `block`.
 */
export function withLines(
  block: ParagraphFragmentRecord,
  lines: ParagraphFragmentRecord['lines']
): ParagraphFragmentRecord {
  const copy = { ...block, lines };
  if (movableBlocks.has(block)) movableBlocks.add(copy);
  return copy;
}

interface ColumnGeometry {
  readonly lefts: readonly number[];
  readonly widths: readonly number[];
  readonly total: number;
}

/**
 * Cell left edges and single-column widths for one column-width array, computed by the
 * same `sumCols` calls row placement makes, so every value is bit-identical to placement's.
 */
const columnGeometry = new WeakMap<readonly number[], ColumnGeometry>();
function columnGeometryOf(cols: readonly number[]): ColumnGeometry {
  let known = columnGeometry.get(cols);
  if (!known) {
    known = {
      lefts: cols.map((_, index) => sumCols(cols, 0, index)),
      widths: cols.map((_, index) => sumCols(cols, index, index + 1)),
      total: sumCols(cols, 0, cols.length),
    };
    columnGeometry.set(cols, known);
  }
  return known;
}

/** A cell paragraph at new widths, and for a new row top what the row's height reads. */
interface MovedParagraph {
  readonly block: ParagraphFragmentRecord;
  readonly x: number;
  readonly width: number;
  readonly insets: CellContentInsets;
  /** Width of the cell's flow box, as `cellReservedMarkHeights` reads it. */
  readonly flowWidth: number;
  /** The content band `layoutRowFragmentBounded` gets back from the cell flow; NaN in place. */
  readonly contentTop: number;
  readonly contentBottom: number;
}

const NO_ZONES: readonly never[] = [];

/** The cell at new widths, or null when a fresh placement could differ. */
function moveCell(
  cell: SemanticTableRow['cells'][number],
  placed: TableCellFragmentRecord,
  context: MoveContext,
  compact?: CellWidthPlacement
): TableCellFragmentRecord | null {
  const moved = moveCellParagraph(cell, placed, context, undefined, compact);
  // Row finalize resolves `borders` again in the same key position.
  return (
    moved && {
      ...placed,
      blocks: [moved.block],
      box: { ...placed.box, x: moved.x, width: moved.width },
    }
  );
}

/**
 * The cell's paragraph at new widths. With `rowTop`, also at that row top: its vertical values
 * are computed as `placeCellParagraph` computes them for a complete first fragment, through the
 * shared expressions of `table-row-vertical.ts`, from the operands placement captured.
 */
function moveCellParagraph(
  cell: SemanticTableRow['cells'][number],
  placed: TableCellFragmentRecord,
  context: MoveContext,
  rowTop: number | undefined,
  compact?: CellWidthPlacement
): MovedParagraph | null {
  const { deps, cache, cols, geometry } = context;
  const paragraph = cell.blocks[0];
  const block = placed.blocks[0];
  if (
    cell.blocks.length !== 1 ||
    placed.blocks.length !== 1 ||
    paragraph?.kind !== 'paragraph' ||
    block?.kind !== 'paragraph' ||
    block.paragraphId !== paragraph.id ||
    deps.listItems?.has(paragraph.id)
  )
    return null;
  if (movedRowsObserver && !movableBlocks.has(block)) movedRowsObserver.fieldScans += 1;
  if (!onlyMovableFields(block)) return null;
  const known = cellLines.get(block.range);
  if (
    !known ||
    known.paragraph !== paragraph ||
    known.measurer !== context.measurer ||
    known.styleCascade !== context.styleCascade ||
    known.compatibilityMode !== deps.compatibilityMode ||
    known.displayMode !== deps.displayMode ||
    known.revisionAuthorFilter !== context.revisionAuthorFilter
  )
    return null;
  // Cell and content boxes exactly as row placement derives them, cell spacing excluded.
  const { gridColumn, gridSpan } = cell;
  const single = gridSpan === 1 && gridColumn < cols.length;
  const x = context.left + (single ? geometry.lefts[gridColumn]! : sumCols(cols, 0, gridColumn));
  const width = Math.max(
    (single
      ? geometry.widths[gridColumn]!
      : sumCols(cols, gridColumn, Math.min(gridColumn + gridSpan, cols.length))) || geometry.total,
    MIN_CELL_BOX_PT
  );
  const insets = deps.cellContentInsets?.get(cell.id) ?? sharedCellContentInsets(cell, true);
  // `cellFlowBox` as row placement calls it: an unbounded row, so the content has no floor.
  const flowBox = cellFlowBox(false, x, width, rowTop ?? 0, Number.POSITIVE_INFINITY, insets);
  const { flowLeft, flowRight } = flowBox;
  const contentWidth = Math.max(1, flowRight - flowLeft);
  // A move reads the memo without replacing it: only `available` depends on width.
  const inputs =
    memoizedCellParagraphInputs(
      paragraph,
      deps.styleCascade,
      undefined,
      cell.styleFormatting,
      deps.paragraphLineUnitPt
    ) ??
    cellParagraphInputs(
      paragraph,
      contentWidth,
      deps.styleCascade,
      undefined,
      cell.styleFormatting,
      deps.paragraphLineUnitPt
    );
  if (!sameInputsExceptWidth(inputs, known.inputs)) return null;
  const { indent } = inputs;
  const available = cellAvailableWidth(inputs, contentWidth);
  const hostedListToken = deps.hostedStory?.hostedListTokenForParagraph?.(paragraph) ?? '';
  const refToken = deps.refFields?.tokenForParagraph(paragraph.id) ?? '';
  const { tabStops, properties } =
    memoizedCellParagraphBreakInputs(
      paragraph,
      inputs,
      deps.defaultTabStopPt,
      undefined,
      hostedListToken,
      refToken
    ) ??
    cellParagraphBreakInputs(paragraph, inputs, deps.defaultTabStopPt, {
      listToken: undefined,
      hostedListToken,
      refToken,
    });
  if (
    !cellBreakKeyPartsMatch(
      paragraph,
      deps,
      known.parts.inTableCell,
      known.parts.cellEndMark,
      rowsClearOutOfCellFloats(deps, paragraph.id),
      known.parts
    ) ||
    !sameProperties(properties, known.properties)
  )
    return null;
  // The entry placement read: every key input but width matches, so a fresh placement at this
  // width takes the same line whenever the cache's own width transfer accepts it.
  const lines = cache.get(known.key);
  if (compact) {
    const c = compact.constraint;
    if (
      compact.baseline !== placed ||
      compact.breakKey !== known.key ||
      !lines ||
      (compact.numericLines
        ? compact.numericLines !== lines
        : lines.length !== 1 || lines[0] !== compact.pending) ||
      c.gridColumn !== gridColumn ||
      c.gridSpan !== gridSpan ||
      c.insetLeft !== insets.left ||
      c.insetRight !== insets.right ||
      c.indentLeft !== indent.left ||
      c.indentRight !== indent.right ||
      compact.alignment !== inputs.alignment ||
      compact.firstLineOffset !==
        directionalListFirstLineShift(undefined, indent, deps.measurer, tabStops, available, false)
    )
      return null;
    if (rowTop === undefined) {
      const materialized = placeCellFromWidthRecipe(compact, context.cols, context.left);
      const moved = materialized?.blocks[0];
      if (
        !materialized ||
        moved?.kind !== 'paragraph' ||
        materialized.box.x !== x ||
        materialized.box.width !== width
      )
        return null;
      movableBlocks.add(moved);
      deps.onCellBreakKey?.(known.key);
      return {
        block: moved,
        x,
        width,
        insets,
        flowWidth: flowRight - flowLeft,
        contentTop: Number.NaN,
        contentBottom: Number.NaN,
      };
    }
  }
  if (lines && lines.length > 1) {
    if (
      inputs.alignment === 'both' ||
      block.lines.length !== lines.length ||
      !numericLinesHoldAtWidth(lines, available) ||
      !block.lines.every((line, index) => placedFrom(line, lines[index]!)) ||
      directionalListFirstLineShift(
        undefined,
        indent,
        deps.measurer,
        tabStops,
        available,
        false
      ) !== 0
    )
      return null;
    const lineIndent = flowLeft + indent.left;
    const movedLines: LineRecord[] = [];
    let probeY =
      rowTop === undefined
        ? Number.NaN
        : cellParagraphFirstTop(
            flowBox.contentTop,
            known.vertical.appliedBefore,
            known.vertical.topExtent
          );
    for (const [index, pending] of lines.entries()) {
      const old = block.lines[index]!;
      const skip =
        rowTop === undefined ? 0 : pendingLineExclusionSkipAtPlacement(pending, probeY, NO_ZONES);
      const lineTop = rowTop === undefined ? old.box.y : probeY + skip;
      const content = alignCellLine(
        pending,
        paragraph.id,
        flowLeft,
        lineTop,
        [],
        lineIndent,
        Math.max(1, available),
        index === lines.length - 1,
        {
          measurer: deps.measurer,
          styleCascade: deps.styleCascade,
          props: inputs.props,
          alignment: inputs.alignment,
          rtl: false,
          inTableCell: known.parts.inTableCell,
        }
      );
      if (
        content.spans.length !== (compact ? pending.spans.length : old.spans.length) ||
        content.spans.some(
          (span, at) => span.box.y !== (rowTop === undefined ? old.spans[at]!.box.y : lineTop)
        )
      )
        return null;
      movedLines.push({
        ...old,
        spans: content.spans,
        contentX: lineContentX(content.spans, [], lineIndent + content.offset),
        box: { ...old.box, x: lineIndent, y: lineTop, width: available },
      });
      probeY += skip + pending.height;
    }
    const bottom = probeY + known.vertical.appliedAfter;
    const moved = {
      ...block,
      lines: movedLines,
      box:
        rowTop === undefined
          ? { ...block.box, x: lineIndent, width: available }
          : {
              ...block.box,
              x: lineIndent,
              y: flowBox.contentTop,
              width: available,
              height: bottom - flowBox.contentTop,
            },
    };
    movableBlocks.add(moved);
    context.capture?.(
      captureCellWidthPlacement(
        placed,
        lines[0]!,
        {
          gridColumn,
          gridSpan,
          insetLeft: insets.left,
          insetRight: insets.right,
          indentLeft: indent.left,
          indentRight: indent.right,
        },
        0,
        inputs.alignment,
        known.key,
        lines
      )
    );
    deps.onCellBreakKey?.(known.key);
    return {
      block: moved,
      x,
      width,
      insets,
      flowWidth: flowRight - flowLeft,
      contentTop: rowTop === undefined ? Number.NaN : flowBox.contentTop,
      contentBottom: rowTop === undefined ? Number.NaN : bottom,
    };
  }
  const old = block.lines[0]!;
  const pending = lines?.length === 1 ? lines[0]! : undefined;
  if (!pending || !placedFrom(old, pending) || !lineHolds(pending, available)) return null;
  const firstLineOffset = directionalListFirstLineShift(
    undefined,
    indent,
    deps.measurer,
    tabStops,
    available,
    false
  );
  const lineIndent = flowLeft + indent.left + firstLineOffset;
  const lineWidth = Math.max(1, available - firstLineOffset);
  // In place the line keeps its y. At a new top: the first line's top, plus the exclusion skip,
  // which is 0 without zones and for a line not tied to placement (`placedFrom`).
  let lineTop = old.box.y;
  if (rowTop !== undefined) {
    const { appliedBefore, topExtent } = known.vertical;
    const first = cellParagraphFirstTop(flowBox.contentTop, appliedBefore, topExtent);
    lineTop = first + pendingLineExclusionSkipAtPlacement(pending, first, NO_ZONES);
  }
  const content = alignCellLine(
    pending,
    paragraph.id,
    flowLeft,
    lineTop,
    [],
    lineIndent,
    lineWidth,
    true,
    {
      measurer: deps.measurer,
      styleCascade: deps.styleCascade,
      props: inputs.props,
      alignment: inputs.alignment,
      rtl: false,
      inTableCell: known.parts.inTableCell,
    }
  );
  const spans = content.spans;
  // Alignment moves spans along x only; anything else is not this line any more.
  if (spans.length !== (compact ? pending.spans.length : old.spans.length)) return null;
  for (let index = 0; index < spans.length; index += 1)
    if (spans[index]!.box.y !== (rowTop === undefined ? old.spans[index]!.box.y : lineTop))
      return null;
  const line = {
    ...old,
    spans,
    contentX: lineContentX(spans, [], lineIndent + content.offset),
    box:
      rowTop === undefined
        ? { ...old.box, x: flowLeft + indent.left, width: available }
        : { ...old.box, x: flowLeft + indent.left, y: lineTop, width: available },
  };
  // A complete paragraph without rules: the lines end one line below the top, then its space
  // after (`placeCellParagraph`); its box runs from the flow top to there.
  const linesBottom = lineTop + pending.height;
  const bottom = linesBottom + known.vertical.appliedAfter;
  const moved: ParagraphFragmentRecord = {
    ...block,
    lines: [line],
    box:
      rowTop === undefined
        ? { ...block.box, x: flowLeft + indent.left, width: available }
        : {
            ...block.box,
            x: flowLeft + indent.left,
            y: flowBox.contentTop,
            width: available,
            height: bottom - flowBox.contentTop,
          },
  };
  if (context.capture && rowTop === undefined) {
    context.capture(
      captureCellWidthPlacement(
        placed,
        pending,
        {
          gridColumn,
          gridSpan,
          insetLeft: insets.left,
          insetRight: insets.right,
          indentLeft: indent.left,
          indentRight: indent.right,
        },
        firstLineOffset,
        inputs.alignment,
        known.key
      )
    );
  }
  movableBlocks.add(moved);
  deps.onCellBreakKey?.(known.key);
  return {
    block: moved,
    x,
    width,
    insets,
    flowWidth: flowRight - flowLeft,
    contentTop: rowTop === undefined ? Number.NaN : flowBox.contentTop,
    contentBottom: rowTop === undefined ? Number.NaN : bottom,
  };
}

/**
 * `placed` (a finalized row of the previous layout) at new column widths and table origin,
 * or null when any cell needs a fresh placement. Vertical geometry is the placed row's.
 */
export function moveRowToWidths(
  row: SemanticTableRow,
  placed: TableRowFragmentRecord,
  cols: readonly number[],
  left: number,
  deps: TableFlowDeps,
  capture?: (recipe: CellWidthPlacement | null) => void,
  compact?: readonly CellWidthPlacement[]
): TableRowFragmentRecord | null {
  if (
    row.isHeader ||
    placed.isHeaderRepeat ||
    placed.isContinuation ||
    placed.hasContinuation ||
    row.cells.length !== placed.cells.length ||
    (compact && compact.length !== row.cells.length) ||
    !deps.cache
  )
    return null;
  const geometry = columnGeometryOf(cols);
  const context: MoveContext = {
    capture,
    deps,
    cache: deps.cache,
    measurer: identityOf(deps.measurer),
    styleCascade: identityOf(deps.styleCascade),
    revisionAuthorFilter: identityOf(deps.revisionAuthorFilter),
    cols,
    geometry,
    left,
  };
  const cells: TableCellFragmentRecord[] = [];
  for (let index = 0; index < row.cells.length; index += 1) {
    const cell = row.cells[index]!;
    const before = placed.cells[index]!;
    if (
      cell.id !== before.id ||
      cell.vMergeContinue ||
      cell.textDirection !== 'horizontal' ||
      before.rowSpan !== 1 ||
      before.paintInert
    )
      return null;
    const moved = moveCell(cell, before, context, compact?.[index]);
    if (!moved) return null;
    cells.push(moved);
  }
  if (movedRowsObserver) {
    movedRowsObserver.moved += 1;
    if (compact) movedRowsObserver.compact += 1;
  }
  return { ...placed, cells, box: { ...placed.box, x: left, width: geometry.total } };
}

/** Why a row at a new top was placed fresh; see `shiftedRowsTestRecorder`. */
export type ShiftedRowRefusal = 'record' | 'row' | 'height' | 'cell' | 'floor';

let shiftedRowsObserver: {
  moved: number;
  compact: number;
  refused: Record<ShiftedRowRefusal, number>;
} | null = null;

/** @internal Counts rows rebuilt at a new top and refusals by first reason, for tests and probes. */
export function shiftedRowsTestRecorder(): {
  readonly moved: number;
  readonly compact: number;
  readonly refused: Readonly<Record<ShiftedRowRefusal, number>>;
  dispose(): void;
} {
  const observer = {
    moved: 0,
    compact: 0,
    refused: { record: 0, row: 0, height: 0, cell: 0, floor: 0 },
  };
  shiftedRowsObserver = observer;
  return {
    get moved() {
      return observer.moved;
    },
    get compact() {
      return observer.compact;
    },
    get refused() {
      return observer.refused;
    },
    dispose() {
      if (shiftedRowsObserver === observer) shiftedRowsObserver = null;
    },
  };
}

/** Count one refusal; returns null for the caller to return. */
export function noteShiftedRowRefusal(reason: ShiftedRowRefusal): null {
  if (shiftedRowsObserver) shiftedRowsObserver.refused[reason] += 1;
  return null;
}

/**
 * `placed` (a row of an earlier layout) at new widths and the new row top `top`: the record and
 * bottom a fresh complete `layoutRowFragment(row, cols, left, top)` gives, or null.
 *
 * Each cell comes from `moveCellParagraph` at `top`. The row then repeats the vertical steps of
 * `layoutRowFragmentBounded` for an unbounded row with no merge, no wrap zones and no spacing:
 * each cell's bottom from its mark floor and content, the row bottom, the `w:trHeight` atLeast
 * floor (`authoredRowMinimumFloorPt`), the row height, and vertical alignment through
 * `shiftBlocks`. Multi-term expressions come from `table-row-vertical.ts`, shared with row
 * placement; the rest are single operations or `Math.min`/`Math.max`.
 */
export function moveRowToTop(
  row: SemanticTableRow,
  placed: TableRowFragmentRecord,
  cols: readonly number[],
  left: number,
  top: number,
  deps: TableFlowDeps,
  compact?: readonly CellWidthPlacement[]
): { readonly record: TableRowFragmentRecord; readonly bottom: number } | null {
  if (
    row.isHeader ||
    placed.isHeaderRepeat ||
    placed.isContinuation ||
    placed.hasContinuation ||
    row.cells.length === 0 ||
    row.cells.length !== placed.cells.length ||
    (compact && compact.length !== row.cells.length) ||
    !deps.cache
  )
    return noteShiftedRowRefusal('row');
  // An exact row clips to its authored box, a branch this does not repeat.
  if (row.height.rule === 'exact') return noteShiftedRowRefusal('height');
  const geometry = columnGeometryOf(cols);
  const context: MoveContext = {
    deps,
    cache: deps.cache,
    measurer: identityOf(deps.measurer),
    styleCascade: identityOf(deps.styleCascade),
    revisionAuthorFilter: identityOf(deps.revisionAuthorFilter),
    cols,
    geometry,
    left,
  };
  const entries: { cell: SemanticTableRow['cells'][number]; moved: MovedParagraph }[] = [];
  const bottoms: number[] = [];
  let rowBottom = top;
  for (let index = 0; index < row.cells.length; index += 1) {
    const cell = row.cells[index]!;
    const before = placed.cells[index]!;
    if (
      cell.id !== before.id ||
      cell.vMergeContinue ||
      cell.textDirection !== 'horizontal' ||
      before.rowSpan !== 1 ||
      before.paintInert
    )
      return noteShiftedRowRefusal('cell');
    const moved = moveCellParagraph(cell, before, context, top, compact?.[index]);
    if (!moved) return noteShiftedRowRefusal('cell');
    // A complete paragraph cell: its mark floor applies when its box has height.
    const { markFloor } = cellReservedMarkHeights(cell, moved.flowWidth, deps, {
      vertical: false,
      markSizedRow: false,
    });
    const appliedMarkFloor = moved.block.box.height > 0 ? markFloor : 0;
    const cellBottom = Math.min(
      Number.POSITIVE_INFINITY,
      Math.max(top + appliedMarkFloor, moved.contentBottom + moved.insets.bottom)
    );
    if (cellBottom > rowBottom) rowBottom = cellBottom;
    entries.push({ cell, moved });
    bottoms.push(cellBottom);
  }
  rowBottom = Math.min(Number.POSITIVE_INFINITY, Math.max(rowBottom, top));
  for (const needed of bottoms)
    if (needed > rowBottom && needed <= Number.POSITIVE_INFINITY + 0.001) rowBottom = needed;
  // Placement gives a row nothing raised its line-height fallback; this does not repeat it.
  if (rowBottom <= top + 0.001) return noteShiftedRowRefusal('floor');
  rowBottom = Math.min(Number.POSITIVE_INFINITY, rowBottom);
  const authoredFloorPt =
    row.height.rule === 'atLeast'
      ? authoredRowMinimumFloorPt(
          row.height.valuePt,
          entries.map((entry) => ({ cell: entry.cell, insets: entry.moved.insets })),
          deps.cellMinimumContentInsets
        )
      : 0;
  const minBottom = top + Math.max(authoredFloorPt, 0);
  if (minBottom > rowBottom && minBottom <= Number.POSITIVE_INFINITY + 0.001) rowBottom = minBottom;
  rowBottom = Math.min(Number.POSITIVE_INFINITY, rowBottom);
  const rowHeight = Math.max(0, rowBottom - top);
  const cells = entries.map(({ cell, moved }, index): TableCellFragmentRecord => {
    let blocks: BlockFragmentRecord[] = [moved.block];
    if (cell.vAlign !== 'top') {
      const contentHeight = moved.contentBottom - moved.contentTop;
      const available = cellAlignmentRoom(
        rowHeight,
        moved.insets.top,
        moved.insets.bottom,
        contentHeight
      );
      if (available > 0) blocks = shiftBlocks(blocks, cellAlignmentShift(cell.vAlign, available));
    }
    // A fresh placement has no borders yet; finalize adds them, at the end, as it does there.
    const { borders: _borders, ...unresolved } = placed.cells[index]!;
    return {
      ...unresolved,
      blocks,
      box: { x: moved.x, y: top, width: moved.width, height: rowHeight },
    };
  });
  if (shiftedRowsObserver) {
    shiftedRowsObserver.moved += 1;
    if (compact) shiftedRowsObserver.compact += 1;
  }
  return {
    record: {
      ...placed,
      cells,
      box: { x: left, y: top, width: geometry.total, height: rowHeight },
    },
    bottom: rowBottom,
  };
}
