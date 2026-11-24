// CT_TblWidth reading, and the reconciliation that turns authored width statements into the
// column grid a table is laid out on.
//
// This is separate from the structural read in `semantic-table.ts` because settling a column
// is not a per-cell read. `w:tblGrid` only seeds the columns, and 17.18.87 settles the rest
// by looking at every cell that covers a column across every row — a whole algorithm with its
// own bounds, reached through a single call once the structural walk has collected the
// claims. Keeping it here leaves that walk a walk, and leaves the width algebra somewhere it
// can be read end to end.
//
// All widths leave here in POINTS — twips are converted once at this boundary, matching
// `geometryOfSection` and `paragraphIndent`.
//
// Every value below is attacker-controlled (a .docx is a zip of XML the author fully
// controls). `resolveColumnWidthsPt` bounds span and column counts before allocation and
// avoids spread over attacker-sized collections — note the claim list it consumes grows with
// the table's CELL count, not its column count, so it must never be spread or passed as
// varargs. Do not relax these limits: hostile inputs can otherwise trigger multi-gigabyte
// allocation attempts or spread-arity failures that vary by JavaScript engine.
//
// Widths resolve to a positive number or not at all. A column that no evidence settles takes
// a bounded share of what is left rather than zero, and no fit may scale a table below one
// point per column — a zero-width column is unrecoverable downstream.

import {
  readTwipsMeasure,
  WML_NAMESPACE_URI,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';
import { MAX_TABLE_COLUMNS } from '../store/store/table-constraints.ts';
import { columnsAroundCells } from './table-cell-spacing.ts';
import {
  fitColumnsAboveMinimums,
  fitColumnsHoldingFrame,
  type SpacingTake,
} from './table-column-fit.ts';

export { MAX_TABLE_COLUMNS };

/**
 * Soft ceiling on one grid column (~22", Word's widest page). `w:gridCol/@w:w` is the one
 * geometry number a file states that every cell box, row box and border stroke inherits, so
 * it is read and clamped exactly like `twipsSide` reads a margin.
 */
export const MAX_COLUMN_WIDTH_PT = 31_680 / 20;

/**
 * `w:tblW` / `w:tcW` / `w:wBefore` (CT_TblWidth, 17.4.63 / 17.4.71 / 17.4.86): a PREFERRED
 * width plus the unit it is stated in. Preferred is the operative word — it is what the
 * producer asked for, not what the table resolved to.
 *
 * `pct` is stated in fiftieths of a percent (5000 = 100%) by Word, and in the `"50%"`
 * string form of `ST_Percentage` by others; both are read. `auto` and `nil` carry no width.
 */
export type PreferredWidthType = 'dxa' | 'pct' | 'auto' | 'nil';

/**
 * `w:tblW` / `w:tcW` — a requested width, whose UNIT depends on its type.
 *
 * Points for `dxa`, percent for `pct`, and zero for `auto`/`nil`. Reading `value` without `type`
 * is always wrong.
 */
export interface PreferredWidth {
  readonly type: PreferredWidthType;
  /** POINTS for `dxa`, PERCENT for `pct` (0–100, or up to 655.34 for a table), 0 otherwise. */
  readonly value: number;
}

/** The frozen "no preferred width" value — what a table or cell that declares none resolves to. */
export const AUTO_PREFERRED_WIDTH: PreferredWidth = Object.freeze({ type: 'auto', value: 0 });

/** Widest a `pct` preference may resolve to, so `w:w="999999"` cannot inflate a table. */
const MAX_PREFERRED_PERCENT = 100;

/** Widest TABLE percentage honoured above 100, as a signed 16-bit count of fiftieths. */
export const MAX_TABLE_PERCENT_UNITS = 32_767;

/**
 * A bare table percentage is a 16-bit count of fiftieths: a larger count wraps, and a count
 * that wraps to zero or past the signed range states no width. `undefined` means `auto`.
 */
export function wrappedTablePercentUnits(units: number): number | undefined {
  const wrapped = units % 65_536;
  return wrapped > 0 && wrapped <= MAX_TABLE_PERCENT_UNITS ? wrapped : undefined;
}

/** The narrowest stated table percentage: one fiftieth of a percent. */
const MIN_TABLE_PERCENT = 1 / 50;

/** A width stated without a unit: its type says whether it is twips or fiftieths of a percent. */
const UNITLESS = /^[+-]?\d{0,9}(?:\.\d{0,32})?$/;

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === localName
    )
      return child;
  }
  return undefined;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName
  )?.value;
}

/**
 * Bounded reader for `ST_MeasurementOrPercent` — the union `w:w` actually admits. Word
 * writes the plain twips form, but `ST_UniversalMeasure` (`2.5in`, `72pt`) and
 * `ST_Percentage` (`33.3%`, the form 17.4.71's own example uses) are equally valid, and
 * dropping them silently loses geometry a conformant producer stated. Lengths go through
 * `readTwipsMeasure`, so a decimal (`9026.0`) truncates to whole twips.
 *
 * Every branch is anchored with a bounded quantifier: these run over attacker-controlled
 * attribute values and must not backtrack.
 */
function readMeasurementOrPercent(
  raw: string
):
  | { readonly kind: 'length'; readonly pt: number }
  | { readonly kind: 'percent'; readonly percent: number }
  | null {
  const percent = /^(\d{1,7}(?:\.\d{1,4})?)%$/.exec(raw);
  if (percent) {
    const value = Number(percent[1]);
    return Number.isFinite(value) ? { kind: 'percent', percent: value } : null;
  }
  const twips = readTwipsMeasure(raw);
  // A width is unsigned: a negative one is no length at all.
  return twips !== null && twips >= 0 ? { kind: 'length', pt: twips / 20 } : null;
}

/**
 * Read a CT_TblWidth element, clamped exactly like `twipsSide`: every number here is
 * attacker-controlled and feeds cell box geometry.
 *
 * An absent `w:type` is `dxa` per 17.4.87 (the schema declares no default, the prose does).
 * An unrecognised type is NOT read as `dxa` — every sibling reader rejects a value it does
 * not recognise rather than reinterpreting it, and reading `w:type="Pct"` as an absolute
 * measurement turns a 100% table into a 250pt one.
 *
 * 17.4.87 also settles the conflict case: where the type and the measurement `w:w` actually
 * states contradict each other, the measurement wins and the type is ignored.
 */
export function readPreferredWidth(node: OoxmlElement | undefined, table = false): PreferredWidth {
  if (!node || node.namespaceUri !== WML_NAMESPACE_URI) return AUTO_PREFERRED_WIDTH;
  const rawType = attributeValue(node, 'type');
  if (rawType !== undefined && rawType !== 'pct' && rawType !== 'dxa') {
    return rawType === 'nil' ? { type: 'nil', value: 0 } : AUTO_PREFERRED_WIDTH;
  }

  const raw = attributeValue(node, 'w');
  if (raw === undefined) return AUTO_PREFERRED_WIDTH;
  const measure = readMeasurementOrPercent(raw);
  if (!measure) return AUTO_PREFERRED_WIDTH;

  // A bare number carries no unit of its own, so the type decides how to read it. A stated
  // `%` or `in` DOES carry one, and 17.4.87 says that statement overrides the type.
  const bare = UNITLESS.test(raw);
  if (measure.kind === 'percent' || (bare && rawType === 'pct')) {
    // A bare `pct` value is fiftieths of a percent, read as whole units like any other.
    const percent = measure.kind === 'percent' ? measure.percent : (measure.pt * 20) / 50;
    if (!Number.isFinite(percent) || percent <= 0) return AUTO_PREFERRED_WIDTH;
    if (!table) return { type: 'pct', value: Math.min(percent, MAX_PREFERRED_PERCENT) };
    // A table may extend past the text column, within a 16-bit count of fiftieths. Past that
    // range a stated percentage lays the table out at its narrowest; a bare count wraps.
    if (measure.kind === 'percent')
      return {
        type: 'pct',
        value: percent * 50 <= MAX_TABLE_PERCENT_UNITS + 1e-6 ? percent : MIN_TABLE_PERCENT,
      };
    const units = wrappedTablePercentUnits(percent * 50);
    return units === undefined ? AUTO_PREFERRED_WIDTH : { type: 'pct', value: units / 50 };
  }
  if (!Number.isFinite(measure.pt) || measure.pt <= 0) return AUTO_PREFERRED_WIDTH;
  return { type: 'dxa', value: Math.min(measure.pt, MAX_COLUMN_WIDTH_PT) };
}

/**
 * `w:tblW` (17.4.63). Unlike a cell's share of its table, a table percentage can exceed 100
 * and extend the table past the text column, up to `MAX_TABLE_PERCENT_UNITS`. The percentage
 * is a share of the same reference width as any other table percentage.
 */
export function readTablePreferredWidth(node: OoxmlElement | undefined): PreferredWidth {
  return readPreferredWidth(node, true);
}

/** A CT_TblWidth read down to points, for the `dxa` geometry the placement reads use. */
export function preferredLengthPt(
  node: OoxmlElement | undefined,
  limit: number
): number | undefined {
  if (!node) return undefined;
  const width = readPreferredWidth(node);
  if (width.type !== 'dxa') return undefined;
  return Math.min(width.value, limit);
}

/**
 * `w:tblInd` (17.4.50) read to SIGNED points, clamped to `[-limit, limit]`; `undefined` when
 * the element states no usable indent, so the style cascade supplies one.
 *
 * An indent is a signed offset: a negative value pulls the table into the leading margin.
 * Only this reader accepts the sign. Widths, margins and cell spacing keep the unsigned
 * `readPreferredWidth` path, where zero or a negative value is no width at all. Here a
 * stated zero IS a value, so it overrides a style's indent.
 *
 * The type rules follow `readPreferredWidth`: an absent type is `dxa`, a bare number under
 * `pct` or any other type states no indent, and a universal measure carries its own unit
 * whatever the type says. A percentage states no indent. Only the bare twips form carries a
 * sign: a captured control places `-0.5in` half an inch INTO the column, so a universal
 * measure reads as its magnitude.
 */
export function readTableIndentPt(
  node: OoxmlElement | undefined,
  limit: number
): number | undefined {
  if (!node || node.namespaceUri !== WML_NAMESPACE_URI) return undefined;
  const type = attributeValue(node, 'type');
  if (type !== undefined && type !== 'dxa' && type !== 'pct') return undefined;
  const raw = attributeValue(node, 'w');
  if (raw === undefined) return undefined;
  if (type === 'pct' && UNITLESS.test(raw)) return undefined;
  const twips = readTwipsMeasure(raw);
  if (twips === null) return undefined;
  const pt = twips / 20;
  // `+ 0` turns a stated `-0` into zero.
  return Math.max(-limit, Math.min(pt, limit)) + 0;
}

/** Declared `w:gridCol` elements, bounded before anything is allocated from them. */
export function gridColumnElements(table: OoxmlElement): readonly OoxmlElement[] {
  const grid = childNamed(table, 'tblGrid');
  if (!grid) return [];
  const cols: OoxmlElement[] = [];
  for (const child of grid.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'gridCol'
    ) {
      cols.push(child);
      if (cols.length >= MAX_TABLE_COLUMNS) break;
    }
  }
  return cols;
}

/**
 * The INITIAL width of each grid column, or undefined for a column `w:tblGrid` does not
 * settle. 17.4.48 calls these the table's "default widths" and 17.4.16 is explicit that they
 * "determine the initial width of each grid column, which can then be overridden by ... the
 * preferred widths of specific cells" — so this is a seed, not the answer.
 *
 * Values are clamped exactly like `twipsSide`: `w="999999999"` otherwise becomes a
 * ~50,000,000pt column that every cell box and border stroke inherits. A column at or past
 * that ceiling is not geometry anyone authored — `MAX_COLUMN_WIDTH_PT` is wider than any
 * legal page — so it is dropped to undefined rather than kept as a 22-inch column that then
 * has to be exempted from every later fit. One unreadable column costs that column only; the
 * rest of the authored grid survives.
 */
function gridColumnWidthsPt(cols: readonly OoxmlElement[]): readonly (number | undefined)[] {
  const widths: (number | undefined)[] = [];
  for (const col of cols) {
    const raw = attributeValue(col, 'w');
    const measure = raw === undefined ? null : readMeasurementOrPercent(raw);
    if (!measure || measure.kind !== 'length' || !Number.isFinite(measure.pt) || measure.pt <= 0) {
      widths.push(undefined);
      continue;
    }
    widths.push(measure.pt > MAX_COLUMN_WIDTH_PT ? undefined : measure.pt);
  }
  return widths;
}

/** One cell's grid footprint and stated width preference. */
export interface CellWidthClaim {
  readonly start: number;
  readonly span: number;
  readonly preferred: PreferredWidth;
}

/** Absolute single-column preferences replace the initial grid when every cell states one. */
function fixedCellWidthSeed(
  seed: readonly (number | undefined)[],
  claims: readonly CellWidthClaim[]
): readonly (number | undefined)[] {
  // Keep the existing reconciliation for spans and unspecified preferences. Those cells
  // can retain part of the initial grid, so their absence is not a zero-width claim.
  if (
    claims.length === 0 ||
    claims.some(
      (claim) =>
        claim.span !== 1 ||
        claim.preferred.type !== 'dxa' ||
        !Number.isFinite(claim.preferred.value) ||
        claim.preferred.value <= 0
    )
  ) {
    return seed;
  }
  const widths: (number | undefined)[] = seed.map(() => undefined);
  for (const claim of claims) {
    if (claim.start < 0 || claim.start >= seed.length) continue;
    widths[claim.start] = Math.max(widths[claim.start] ?? 0, claim.preferred.value);
  }
  return seed.map((width, index) => widths[index] ?? width);
}

/** Floor for a column nothing states, so a resolved grid never contains a zero column. */
const MIN_DERIVED_COLUMN_PT = 1;

/** Rounding slack when comparing a resolved table width against the content box. */
const WIDTH_EPSILON_PT = 0.001;

/**
 * Lay the authored `w:tcW` preferences over the seed grid.
 *
 * 17.18.87 describes exactly this reconciliation: a cell's `tcW` sets the width of the grid
 * columns its `gridSpan` covers, and "for each subsequent row ... each grid column is
 * adjusted to be the MAXIMUM value of the requested widths (if the widths do not agree)".
 * So a later row asking for more wins, and a narrower footprint is authoritative over a
 * spanning one — a span states the total across its columns, not any one column's width.
 *
 * Claims are applied narrowest-span-first so single-column statements land before the spans
 * that contain them; a span then distributes only the width its settled columns have not
 * already accounted for.
 *
 * That maximum settles rows that disagree with EACH OTHER. Against the grid, a stated cell
 * width is not a request for more: it replaces the grid's width for its column, whether the
 * table states its own width or not. Measured in modes 11, 14 and 15, autofit and fixed: a
 * 1000/2368-twip grid whose cells state 1684 each lays out as two equal columns, under an
 * automatic width, a 3368-twip width and an 8640-twip width alike.
 *
 * A `pct` preference cannot express an exact twip, so in a table that states its own width it
 * disagrees with the grid it was computed from by a rounding, which is
 * `legacyRoundedCellClaims`' subject: there it only ever widens the grid.
 */
function applyWidthClaims(
  seed: readonly (number | undefined)[],
  claims: readonly CellWidthClaim[],
  columnCount: number,
  tableWidthPt: number,
  /** What a `pct` cell width is a share of when the table states no width of its own. */
  percentBasisPt = tableWidthPt,
  /** A row the view hides may hold the widths the grid kept, so the grid only widens. */
  gridOnlyWidens = false
): (number | undefined)[] {
  const settled: (number | undefined)[] = [];
  for (let index = 0; index < columnCount; index += 1) settled.push(seed[index]);

  // `.filter` already returns a fresh array, so this never mutates the caller's claims and
  // needs no spread — `claims` grows with the table's cell count and is attacker-sized.
  const ordered = claims
    .filter(
      (claim) =>
        claim.start < columnCount &&
        (claim.preferred.type === 'dxa' || (claim.preferred.type === 'pct' && percentBasisPt > 0))
    )
    .sort((a, b) => a.span - b.span);

  // Columns a claim has stated: later claims there take the maximum, not the grid.
  const claimed = new Set<number>();
  for (const claim of ordered) {
    const last = Math.min(claim.start + claim.span, columnCount);
    if (last <= claim.start) continue;
    // 17.4.71: a `pct` cell width is relative to the overall width of the TABLE. A table
    // that states no width of its own takes the text column as that width (8/92 and 25/75
    // splits of an automatic-width table measured against the text column).
    const stated =
      claim.preferred.type === 'pct'
        ? (percentBasisPt * claim.preferred.value) / 100
        : claim.preferred.value;
    if (!Number.isFinite(stated) || stated <= 0) continue;

    if (last - claim.start === 1) {
      // A single-column claim states that column outright, replacing the grid; maximum wins
      // across rows. A share of a stated table width only widens the grid.
      const outright = !gridOnlyWidens && (claim.preferred.type === 'dxa' || tableWidthPt <= 0);
      const current = outright && !claimed.has(claim.start) ? undefined : settled[claim.start];
      claimed.add(claim.start);
      settled[claim.start] = current === undefined ? stated : Math.max(current, stated);
      continue;
    }
    // A span only gets to state the columns nothing narrower has settled, and only with
    // whatever of its total those settled columns leave over.
    const open: number[] = [];
    let remaining = stated;
    for (let index = claim.start; index < last; index += 1) {
      const current = settled[index];
      if (current === undefined) open.push(index);
      else remaining -= current;
    }
    if (remaining <= 0) continue;
    if (open.length === 0) {
      // Measured in modes 0 and 15: a span wider than columns its rows' narrower cells
      // state widens the last of them. 9794 twips over 3686/942/1466/1466/1577 adds 657
      // to the fifth; 8000 over 2000/2000/2000 lays out as 100/100/200pt.
      let stated = true;
      for (let index = claim.start; index < last; index += 1)
        if (!claimed.has(index)) stated = false;
      if (stated) settled[last - 1] = settled[last - 1]! + remaining;
      continue;
    }
    const each = remaining / open.length;
    for (const index of open) settled[index] = each;
  }
  return settled;
}

/**
 * The table's resolved column widths, in points.
 *
 * `w:tblGrid` seeds the columns, the authored `w:tcW`/`w:wBefore` preferences are laid over
 * it (see {@link applyWidthClaims}), and anything still unstated shares what the content
 * width has left. Columns never resolve to zero.
 *
 * A stated preferred width bounds the initial grid. The text column bounds an autofit
 * table only when no positive table width is authored. A requested width may extend into
 * the margins; clamping it to the text column changes both alignment and cell wrapping.
 * The AutoFit content-growth limit does not shrink an already-authored wider table.
 *
 * A stated table width is a two-way instruction: a grid narrower than a `pct` or `dxa` width
 * stretches up to it, in proportion to its columns, as well as shrinking down to it. Measured
 * in modes 11, 14 and 15, autofit and fixed, top-level and nested: a 1684-twip grid under an
 * 8640-twip `w:tblW` fills 8640, two equal columns under it take 4320 each, and 1000/3000
 * under 6000 lay out as 1500/4500. Only an absent width shrinks a grid to the page and never
 * stretches it.
 */
export function resolveColumnWidthsPt(input: {
  readonly gridCols: readonly OoxmlElement[];
  readonly claims: readonly CellWidthClaim[];
  readonly columnCount: number;
  readonly contentWidthPt: number;
  readonly tableWidth: PreferredWidth;
  readonly layoutFixed: boolean;
  readonly hasOmittedRows?: boolean;
  /** Each column's fixed-layout minimum (`fitColumnsAboveMinimums`). */
  readonly minimumsPt?: readonly number[];
  /** What a spaced table's gaps and frame take from its width. */
  readonly spacing?: SpacingTake;
  /** Receives the cell widths before a table width fits them, when it changes them. */
  readonly statedOut?: { widths?: readonly number[] };
}): readonly number[] {
  const { columnCount, tableWidth } = input;
  if (input.statedOut) input.statedOut.widths = undefined;
  // A caller with a degenerate or non-finite content box has told us nothing about the page.
  // The authored grid is still perfectly good evidence on its own, so resolve from it and
  // skip the page clamp rather than scaling the table down to a sliver of a width that was
  // never a real measurement.
  const hasPage = Number.isFinite(input.contentWidthPt) && input.contentWidthPt > 0;
  const available = hasPage ? input.contentWidthPt : MIN_DERIVED_COLUMN_PT;

  // 17.4.63: a `pct` TABLE width is relative to the page's text extents, unlike `tcW`'s
  // basis, which is the table itself.
  const statedTableWidth =
    tableWidth.type === 'dxa'
      ? tableWidth.value
      : tableWidth.type === 'pct'
        ? (available * tableWidth.value) / 100
        : 0;

  const grid = gridColumnWidthsPt(input.gridCols);
  const seed =
    input.layoutFixed && !input.hasOmittedRows && statedTableWidth <= 0
      ? fixedCellWidthSeed(grid, input.claims)
      : grid;
  const settled = applyWidthClaims(
    seed,
    input.claims,
    columnCount,
    statedTableWidth,
    statedTableWidth > 0 ? statedTableWidth : hasPage && !input.layoutFixed ? available : 0,
    input.hasOmittedRows === true
  );

  let stated = 0;
  let unsettled = 0;
  for (const width of settled) {
    if (width === undefined) unsettled += 1;
    else stated += width;
  }
  const resolved: number[] = [];
  if (unsettled > 0) {
    // Nothing states these columns. Give them what the content width has left over, capped
    // at the mean of the stated columns so a `w:gridBefore` band or one unstated column
    // cannot swallow the whole page, and floored so none collapses.
    const mean =
      stated > 0 ? stated / Math.max(columnCount - unsettled, 1) : available / columnCount;
    const leftover = Math.max(available - stated, 0) / unsettled;
    const each = Math.max(Math.min(leftover, mean), MIN_DERIVED_COLUMN_PT);
    for (const width of settled) resolved.push(width ?? each);
  } else {
    for (const width of settled) resolved.push(width!);
  }

  const total = resolved.reduce((sum, width) => sum + width, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return new Array<number>(columnCount).fill(available / columnCount);
  }

  // Never let a stated width crush the table to nothing. `w:tblW w:w="1"` is a hostile
  // instruction rather than a layout request, and a nested table inside a degenerate cell
  // would otherwise be scaled below the hairline `preferredColumnWidthsPt` guarantees. The
  // floor wins over the clamp: overflowing a 3pt cell is recoverable, a zero-width column is
  // not.
  const floor = columnCount * MIN_DERIVED_COLUMN_PT;
  const pageCap = input.layoutFixed || !hasPage ? Number.POSITIVE_INFINITY : available;
  // A spaced table's gaps come out of a stated width. Without one, the table grows by them.
  const gapsPt = input.spacing?.gapsPt ?? 0;
  const gaps = Number.isFinite(gapsPt) && gapsPt > 0 ? gapsPt : 0;
  // A framed table's outer columns hold part of its frame; the rest lies outside an absolute
  // width. A percentage width (`ruleAdjustedTableWidth`, or `legacySpacedPercentWidth`) is
  // the frame's outer extent, out to the far side of the right rule, which draws outward
  // from the table's box. Measured in modes 0 and 15 at 25, 50, 75 and 100%, with outer rules
  // of 0, 0.5 and 6pt on either side.
  const frame = gaps > 0 ? input.spacing?.frame : undefined;
  const held = frame ? frame.leadPt + frame.trailPt : 0;
  const outside = !frame
    ? 0
    : tableWidth.type === 'dxa'
      ? frame.outsidePt
      : // Unmeasured for a right-to-left table in the legacy modes, which keeps its share.
        tableWidth.type === 'pct'
        ? -frame.rightBandPt
        : 0;
  const target = Math.max(
    (statedTableWidth > 0 ? statedTableWidth + outside : Math.min(total + gaps - held, pageCap)) -
      gaps,
    floor
  );

  let cells: readonly number[] = resolved;
  if (frame) {
    // The columns, each with its frame part, fit the width as any columns do.
    const fits = statedTableWidth > 0 || total > target + held + WIDTH_EPSILON_PT;
    cells = fitColumnsHoldingFrame(
      resolved,
      fits ? target : total - held,
      input.minimumsPt ?? [],
      frame,
      input.spacing?.edges,
      !fits
    );
    if (input.statedOut && fits && Math.abs(total - target - held) > WIDTH_EPSILON_PT)
      input.statedOut.widths = resolved;
    return columnsAroundCells(cells, gaps);
  }
  if (total > target + WIDTH_EPSILON_PT) {
    // The gaps, a stated absolute width, and a fixed table's percentage width come out above
    // each column's minimum (17.4.53, 17.4.63).
    const aboveMinimums =
      gaps > 0 || tableWidth.type === 'dxa' || (tableWidth.type === 'pct' && input.layoutFixed);
    cells =
      input.minimumsPt && aboveMinimums
        ? fitColumnsAboveMinimums(resolved, target, input.minimumsPt)
        : resolved.map((width) => (width * target) / total);
  } else if (total < target - WIDTH_EPSILON_PT && statedTableWidth > 0) {
    // A stated width stretches a narrower grid up to it; an absent width only shrinks it.
    cells = resolved.map((width) => (width * target) / total);
  }
  if (input.statedOut && cells !== resolved) input.statedOut.widths = resolved;
  return gaps > 0 ? columnsAroundCells(cells, gaps) : cells;
}

/**
 * Whether a table's absolute width is wider than the text column it sits in. Such a top-level
 * autofit table is laid out at its own width, past the column: a narrower grid stretches up to
 * it, and a column whose content needs more than its share widens the table rather than
 * breaking its words, even past the page edge. A table no wider than the column fits its
 * minimums into the column.
 *
 * Measured in a 451.3pt column with a 489.7pt grid, compatibility mode 15 and legacy alike:
 * `w:tblW` 500pt and 700pt stretch the grid to 500pt and 700pt; `w:noWrap` cells holding
 * 598.5pt keep it under a 500pt or 563pt width; a table only 10.8pt wider than the column
 * grows past the page to hold a long URL (also with a negative indent), and a table exactly as
 * wide as the column breaks it; a 450pt table fits everything into the column. In a 207pt
 * section column, a 300pt table stretches a 150pt grid to 300pt. Right-aligned and centered
 * 500pt tables keep their alignment (into the left margin). A floating table follows the same
 * rule; the indent does not count. Header, footer and note tables measure against their own
 * text column. Nested and text-box tables, whose container is not a text column, keep the
 * column rule, as do fixed-layout tables and percentage widths, for want of evidence.
 */
export function tableWidthPastTextColumn(table: {
  readonly tableWidth: PreferredWidth;
  readonly textColumnPt: number;
  readonly layoutFixed: boolean;
  readonly depth: number;
  readonly textBox?: boolean;
}): boolean {
  const { tableWidth, textColumnPt } = table;
  return (
    !table.layoutFixed &&
    table.depth === 0 &&
    !table.textBox &&
    tableWidth.type === 'dxa' &&
    Number.isFinite(textColumnPt) &&
    textColumnPt > 0 &&
    tableWidth.value > textColumnPt + WIDTH_EPSILON_PT
  );
}

/**
 * The widest a table past its text column grows to hold its minimums: ~22", the widest page a
 * document can declare, the same bound a grid column has. Content that needs more breaks.
 */
export const MAX_TABLE_GROWTH_PT = MAX_COLUMN_WIDTH_PT;
