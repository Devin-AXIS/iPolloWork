// Row heights for a table whose cells merge vertically (17.4.85 `w:vMerge`).
//
// A merged cell covers several rows, so Word sizes the MERGE, not the row that starts it:
// the span gets `max(sum of the spanned rows' own heights, the merged content's height)`.
// Sizing the first row to the whole merged content instead pushes every later row of the
// span down by the full content height — the rows fall off the page and the column beside
// the merge paints as one band of the first row's fill.
//
// The surplus — merged content taller than the rows it covers — goes to the LAST row of the
// span, not evenly across the span. A reference rendering of a four-row merge settles that:
// every row but the last painted at exactly its `w:trHeight` minimum and the last one painted
// 6pt over its minimum, which is the whole surplus. An even split would have moved the
// second and third band edges as well, and the reference left them where the minimums put
// them. A last row with `w:trHeight hRule="exact"` cannot grow (17.18.37), and the surplus
// does NOT move up to an earlier row: every row keeps the height its own cells give it, and
// the merged content is clipped at the span bottom. Reference renderings of two- and
// three-row merges over an exact last row show exactly that.
//
// A span is decided ONE AT A TIME, by the caller, against the page it will really land on:
//
// - `heightOf` says what the span needs, with every span accepted before it folded in;
// - `accept` takes it into the plan — its head is DETACHED from its own row, so the row is
//   sized by the cells that really belong to it, and its rows take height floors;
// - a merge NOT accepted stays exactly where it was before this module existed: its head
//   sizes its own row, and the ordinary row-split machinery paginates it.
//
// The plan binds NOTHING a later row can contradict. It sets a floor under a row's height
// and takes a head's content out of its row's height; every number it hands out is a HEIGHT,
// turned into a position by whoever is placing, so nothing here goes stale when a row moves.
//
// A merged head is measured WHERE IT WILL SIT. `measureRowHeight` is otherwise position-free
// and drops wrap bands on purpose, which under-measures a head a floating drawing makes
// wrap; the span is then too short for its own content, and every way that ends — painting
// past the rows, clipping the tail, splitting a row that cannot split — is a defect. So the
// admission probe runs at the head row's real top with the bands in place. Getting the
// measurement right is the fix; the fallout is not something to choose between.
//
// Two things then keep the content inside the cell:
//
//   1. a detached head stops at the page content box AND at its own span. Both are bounds a
//      cell can hand back a remainder against, so neither swallows the line it stops: the
//      row splits and the next fragment carries the rest, the way any cell does;
//   2. every row of an accepted span lands in the same fragment as its head — the span was
//      admitted only because it fits the page from the head's top, and a covered row may not
//      break a page BEFORE placing something into it.
//
// Nothing here DISCARDS content to stay inside a box. Losing a word is worse than the
// overflow this module exists to stop, so where a bound bites, what it stops is carried.
//
// (2) holds at five break sites, for three different reasons:
//
//   whole-row move        an OPTIMIZATION — the row would sit here — so it is refused for a
//                         covered row, which is the only guard this design needs;
//   `remaining <= 0`      the page is already full, so the fragment reaches the bottom and
//                         so does the furthest (1) let the content go. Safe, allowed;
//   split continuation    the same, after placing to the page bottom. Safe, allowed;
//   `w:cantSplit` unfit   a RECOVERY: refusing it aborts the whole table instead;
//   nothing fitted        a RECOVERY, likewise.
//
// The two recoveries can still end a fragment above content the head already flowed, which
// paints merged text below its table. They stay allowed, because aborting a document is
// worse, and because the accurate admission probe is what stops them being reachable in the
// first place. `float-over-table-harness.ts` is where that claim gets tested.
//
// Declining one merge does not decline its neighbours. When a joint decision (below) does not
// fit the page, its head sizes its own row and every merge headed under it is offered again
// at its own head row, as a decision of its own.
//
// Merges that start in the same row AND end in the same row are ONE decision. They cover the
// same rows, so the plan detaches all of their heads together, measures those rows with none
// of them, and reserves the tallest head. Deciding them one at a time kept every head after
// the first sizing the head row, and the rows below then carried that height a second time.
//
// A span with other merge heads below its head row is decided JOINTLY with them. The
// decision takes every merge headed in a row it covers, and a merge that ends after the span
// (a staircase: it starts inside the span and ends below it) extends the decision to its own
// end row, where more merges can join in turn. One walk goes top to bottom over every row of
// the decision, with all of its heads detached. When the walk reaches a merge's last row,
// that row grows to what the merge still needs below its rows above, so every merge sees the
// surplus an earlier one put in its rows. Reference renderings of two- and three-step
// staircases place each row exactly so: the first merge grows the row the two share, and the
// second merge only adds what that grown row does not give it. The whole decision is one
// admission (it fits the page from the first head, or none of it is taken), one commit, and
// one withdrawal.
//
// Three shapes are declined outright, each from data that cannot change during placement:
//
// - a joint decision with a head row whose merges end in different rows, or with more than
//   `MAX_JOINT_MERGE_GROUPS` head rows. Those heads size their own rows, and a row whose
//   height the decision cannot predict is a row the paginator may move;
// - a joint decision where a merge headed under the first one was already decided alone;
// - a merge starting in a row that already has a plan for a span ending ELSEWHERE. Detaching
//   it empties the head row of what the earlier plan measured there, so the row collapses and
//   that span's rows stop adding up to the height it was sized at — its content then paints
//   below the table. One span length per head row is planned; the rest size their own row.
//
// A span every row of which is `hRule="exact"` and too short for the merged content is
// accepted like any other: its rows keep their fixed heights, and its head flows through
// the whole span and is clipped at the bottom of the last row (`clippedSpanCellIds`). It
// never hands back a remainder, because no row of the span can take more.
//
// Those rules together mean accepted spans that overlap at all were decided TOGETHER: two
// decisions cover disjoint rows, and inside one decision every span may share rows with any
// other. A surplus lands in another span's rows only inside one decision, and the walk
// already counts it: each span's bound is derived from the final floors when its head row
// is placed, so a surplus that a later span adds to a shared row only makes it taller. The
// decision's rows are all held to the fragment of its first head, so a span that runs past
// the first head's own span still lands whole with it. Anything that lets two decisions share
// a row has to add a guard for that.
//
// Measurement is not repeated work: a row inside an accepted span is probed here instead of
// by the paginator, so only the merge head itself costs one extra probe.
//
// The leading `w:tblHeader` rows are planned as their own row list, once for each place the
// group is laid out (`table-header-vmerge.ts`). A merge that runs from a header row into the
// body rows is planned by neither list, so its head keeps sizing its own row.

import type {
  SemanticTableCell,
  SemanticTableRow,
  SemanticTableStructure,
} from './semantic-table.ts';
import { resolveVMergeSpans } from './table-vmerge.ts';

/** Sub-point drift between a probe and the real placement is not a height difference. */
const EPSILON_PT = 0.001;

/**
 * Most merge groups one joint decision walks, the outer one included. Each group heads a
 * later row, so the rows already bound it; this keeps the probes one decision spends bounded
 * even for a long chain of overlapping merges. A larger decision is declined, which is the
 * older behavior.
 */
const MAX_JOINT_MERGE_GROUPS = 64;

/** How the vertical merges accepted so far change ONE row's placement. */
export interface RowVMergeLayoutOptions {
  /**
   * Merge heads in this row that cover later rows. Their content paints from this row but
   * must not size it — the span as a whole carries that height. It is still bounded by the
   * page, like every other cell's, so a head taller than a page paginates as one always did.
   */
  readonly detachedSpanHeightPtByCellId?: ReadonlyMap<string, number>;
  /** Minimum finished height: the row's own height plus any surplus the span put on it. */
  readonly heightFloorPt?: number;
  /**
   * An accepted span headed in an EARLIER row covers this one, so it has to land in the same
   * fragment as that head. Set on a nested head row too, which also detaches its own heads.
   */
  readonly coveredFromAbove?: boolean;
  /**
   * Detached heads whose span is all `hRule="exact"` rows shorter than their content. They
   * flow through the whole span and are clipped at its bottom instead of continuing.
   */
  readonly clippedSpanCellIds?: ReadonlySet<string>;
}

/** One `w:vMerge` chain: the head cell and the rows it covers. */
export interface VMergeSpan {
  readonly headRow: number;
  /** Last row covered, inclusive. Always greater than `headRow`. */
  readonly endRow: number;
  readonly headCellId: string;
}

/** Per-row placement advice for one table; `null` when no merge covers more than one row. */
export interface VMergeRowHeights {
  /** Merges that START at this row, longest first. Decide each before placing the row. */
  spansAt(rowIndex: number): readonly VMergeSpan[];
  /**
   * Points the span needs below its head row's top, with accepted spans folded in. A span
   * sharing its head row and end row with others answers for the whole group: the tallest
   * of their heads, over rows measured with all of them detached.
   * `atYPt` is where the head row is about to be placed; passing it measures the merged
   * content under whatever wrap bands really cross the row instead of position-free.
   */
  heightOf(span: VMergeSpan, atYPt?: number): number;
  /**
   * Take the span into the plan, unless its shape is one the module declines (see the top of
   * this file). Spans sharing its head row and end row join with it, in the same decision.
   *
   * A span already in the plan is left alone — including its `atYPt`. That is not a claim
   * that offering it again somewhere else would be safe: the measurements it was admitted on
   * belong to the y it was FIRST offered at, and a later offer keeps them. No caller does
   * that today (a covered row cannot take the whole-row move, and a head row's span is
   * decided before it is placed), and any caller that wants to re-offer at a new y has to
   * `withdrawAt` the row first and let it be measured again.
   */
  accept(span: VMergeSpan, atYPt?: number): void;
  /**
   * Undo every acceptance headed at this row: its floors, its surplus, and its coverage.
   *
   * For the caller that places a row, finds the head owes a remainder, and places it again
   * with the merge unplanned. Without this the span stays in the plan, so its surplus is
   * still handed to the rows below while the head is once more sizing its own row — the
   * merged height reserved twice, in a table that then paints taller than it needs.
   *
   * Sound because overlapping accepted spans were decided together: the rows a decision
   * covers are covered by nothing else, so withdrawing it at its first head row takes back
   * every span, floor and surplus in those rows.
   *
   * A span headed BELOW a decision's first head row, withdrawn on its own, only stops
   * detaching its heads. Its rows keep every floor, because the heads above were already
   * placed against them. The head placed back in its row can only make those rows taller, so
   * the content of every span above stays inside them. The cost is a possible
   * over-reservation of the surplus, on a retry path only.
   */
  withdrawAt(rowIndex: number): void;
  /** Placement options for a row covered by an accepted span, `undefined` otherwise. */
  rowOptions(rowIndex: number): RowVMergeLayoutOptions | undefined;
}

/**
 * Probes one row's natural height with no page position and no anchor side effects.
 *
 * `detached` is passed straight through to the probe's own row layout, so the probe leaves
 * exactly the cells out that placement will leave out. Emptying a head's blocks instead
 * still charged the row an empty cell's line, and that phantom line became a floor.
 */
export type RowHeightProbe = (
  row: SemanticTableRow,
  detached?: ReadonlySet<string>,
  /** Measure the row at this page-content y, wrap bands included, instead of position-free. */
  atYPt?: number
) => number;

interface MergeHead {
  readonly span: VMergeSpan;
  readonly cell: SemanticTableCell;
}

/** Just the merged cell, at its own grid column: what the span has to be tall enough for. */
function soloHeadRow(row: SemanticTableRow, cell: SemanticTableCell): SemanticTableRow {
  return { ...row, height: { rule: 'auto' }, cells: [cell] };
}

/**
 * The plan holds NO pass-scoped state, and that is the point.
 *
 * It used to draw on a shared allowance — probe layouts first, then cell visits — and either
 * one makes a table's heights depend on how much of the document came before it. An editor
 * cannot afford that: a resumed pass starts at the first changed block, so it spends less of
 * any pool than a cold open, and a table near exhaustion would plan its merges after an edit
 * and not plan them on reload. One document, two shapes, decided by how you opened it.
 *
 * Nothing needs the allowance now. Resolving a merge chain walks the cells of ONE table, and
 * `readTableStructure` bounds those; probes no longer plan the tables inside them
 * (`TableFlowDeps.measuringOnly`), so the nested re-entry that multiplied the work is gone at
 * its source. What is left is linear in the cells a pass already walks to lay the document
 * out. Anything reintroducing a shared counter here brings the drift back with it.
 */

/**
 * Every merge chain in these rows, and the head cells that start one.
 *
 * `resolveVMergeSpans` is called with NO budget here, unlike in finalize, and that is the
 * intent rather than an omission. Finalize spends an aggregate allowance because it runs per
 * page FRAGMENT and re-runs for nested tables inside probes, so its total is not bounded by
 * the document alone. This runs once per table placement over that table's authored rows,
 * which `readTableStructure` has already clamped, so the work is bounded by the same cells
 * the pass walks to lay the table out at all. Giving it an allowance would only reintroduce
 * a counter whose remaining balance depends on document order — see the note at the top.
 */
function collectHeads(rows: readonly SemanticTableRow[]): {
  readonly heads: MergeHead[];
  readonly headIdsByRow: Map<number, Set<string>>;
} {
  const spans = resolveVMergeSpans(rows);
  const heads: MergeHead[] = [];
  const headIdsByRow = new Map<number, Set<string>>();
  for (let headRow = 0; headRow < rows.length; headRow += 1) {
    for (const cell of rows[headRow]!.cells) {
      const covered = spans.get(cell.id);
      if (covered === undefined || covered < 2) continue;
      const endRow = Math.min(headRow + covered - 1, rows.length - 1);
      if (endRow <= headRow) continue;
      heads.push({ span: { headRow, endRow, headCellId: cell.id }, cell });
      const ids = headIdsByRow.get(headRow);
      if (ids) ids.add(cell.id);
      else headIdsByRow.set(headRow, new Set([cell.id]));
    }
  }
  return { heads, headIdsByRow };
}

/**
 * Plan the row heights of one table around its vertical merges.
 *
 * `rows` are the rows the caller places, in order — for a paginated table that is the BODY
 * rows, so a merge is never planned against a repeated header copy of a row. The header rows
 * get a plan of their own for each copy. Returns `null`
 * when no merge covers more than one row, which leaves those tables on exactly the path
 * they were on before.
 */
export function planVMergeRowHeights(
  rows: readonly SemanticTableRow[],
  probeRowHeightPt: RowHeightProbe,
  /** Include occurrence-dependent insets in height-cache keys (outer versus shared top). */
  probeContext?: (row: SemanticTableRow) => string
): VMergeRowHeights | null {
  if (rows.length === 0) return null;
  // Most tables have no vertical merge, and this runs from inside a row PROBE as well as
  // from placement, so the walk that finds none has to be the cheap one: a continuation
  // cell is the only thing that can start a chain, and a scan for one beats building the
  // resolve and its budget accounting to reach the same `null`.
  if (!rows.some((row) => row.cells.some((cell) => cell.vMergeContinue))) return null;
  const { heads, headIdsByRow } = collectHeads(rows);
  if (heads.length === 0) return null;

  const headBySpan = new Map<VMergeSpan, MergeHead>(heads.map((head) => [head.span, head]));
  const spansByRow = new Map<number, VMergeSpan[]>();
  for (const head of heads) {
    const at = spansByRow.get(head.span.headRow);
    if (at) at.push(head.span);
    else spansByRow.set(head.span.headRow, [head.span]);
  }
  // Longest first: the outer merge takes its decision before one that only overlaps it.
  for (const at of spansByRow.values()) at.sort((a, b) => b.endRow - a.endRow);
  /** Spans that cover exactly the same rows, in head-cell order; see `groupOf`. */
  const coextensive = new Map<VMergeSpan, readonly VMergeSpan[]>();
  for (const at of spansByRow.values()) {
    for (let start = 0; start < at.length;) {
      let end = start + 1;
      while (end < at.length && at[end]!.endRow === at[start]!.endRow) end += 1;
      const group = at.slice(start, end);
      for (const span of group) coextensive.set(span, group);
      start = end;
    }
  }

  const basePt = new Map<string, number>();
  const contentPt = new Map<VMergeSpan | string, number>();
  const surplusPt = new Map<number, number>();
  /** Per row, the floor the span that covers it was admitted on — positioned, not position-free. */
  const plannedFloorPt = new Map<number, number>();
  const coveredRows = new Set<number>();
  const acceptedSpans = new Set<VMergeSpan>();
  const acceptedHeadIds = new Set<string>();
  /** Rows with a planned merge already. A second one there collapses the row out from it. */
  const acceptedHeadRows = new Set<number>();
  /** Where each accepted span's head row was offered, so its height re-derives the same. */
  const admittedAtYPt = new Map<VMergeSpan, number | undefined>();
  /** Accepted fixed-row spans whose content is taller than the rows: see `clippedSpanCellIds`. */
  const clippedSpans = new Set<VMergeSpan>();
  /** Which row each accepted span grew, so withdrawing it can take that growth back. */
  const surplusRow = new Map<VMergeSpan, number | undefined>();
  /** Rows below an accepted head that the span covers: see `coveredFromAbove`. */
  const heldRows = new Set<number>();
  /** For a joint decision: its outer head row and every span it accepted, keyed by each. */
  const jointOf = new Map<
    VMergeSpan,
    { readonly headRow: number; readonly lastRow: number; readonly members: readonly VMergeSpan[] }
  >();

  /**
   * The row's height with the heads that are DETACHED from it emptied, and no others.
   *
   * A head nobody took still sizes its own row, so its content belongs in this number: leave
   * it out and the span is judged against a row shorter than the one that gets placed, and
   * the paginator moves a row the span was admitted to keep. `pending` is the heads being
   * decided right now, which are about to join the accepted set if the span is taken. The
   * detached ones are detached in the probe as well, so this is the height placement gives
   * the row and not an approximation of it.
   *
   * `atYPt` measures the row where it is going, bands included, for the same reason the head
   * is measured that way: a float crossing a COVERED row makes it place taller than a
   * position-free floor says, and the span is then admitted against a page it overruns.
   */
  const baseOf = (rowIndex: number, pending?: ReadonlySet<string>, atYPt?: number): number => {
    const emptied = new Set<string>();
    for (const id of headIdsByRow.get(rowIndex) ?? []) {
      if (acceptedHeadIds.has(id) || pending?.has(id) === true) emptied.add(id);
    }
    const at = atYPt === undefined ? '' : `@${atYPt.toFixed(2)}`;
    const key = `${rowIndex}${at}\u0000${probeContext?.(rows[rowIndex]!) ?? ''}\u0000${[...emptied].sort().join('\u0000')}`;
    const known = basePt.get(key);
    if (known !== undefined) return known;
    const measured = probeRowHeightPt(rows[rowIndex]!, emptied, atYPt);
    basePt.set(key, measured);
    return measured;
  };

  /**
   * How tall the merged content is, measured WHERE THE HEAD ROW IS GOING when the caller
   * knows that: a float over the table wraps the head's text, and a span sized from the
   * position-free probe is then too short for its own content. Every way that ends —
   * painting past the rows, clipping the tail, splitting a row that cannot split — is a
   * defect, so the measurement is the thing to get right rather than the fallout.
   */
  const contentOf = (span: VMergeSpan, atYPt?: number): number => {
    const context = probeContext?.(rows[span.headRow]!);
    const key =
      atYPt === undefined && context === undefined
        ? span
        : `${span.headCellId}@${atYPt?.toFixed(2) ?? ''}:${context ?? ''}`;
    const known = contentPt.get(key);
    if (known !== undefined) return known;
    const head = headBySpan.get(span)!;
    const measured = probeRowHeightPt(
      soloHeadRow(rows[span.headRow]!, head.cell),
      undefined,
      atYPt
    );
    contentPt.set(key, measured);
    return measured;
  };

  const floorOf = (rowIndex: number, pending?: ReadonlySet<string>, atYPt?: number): number =>
    baseOf(rowIndex, pending, atYPt) + (surplusPt.get(rowIndex) ?? 0);

  /**
   * The row that takes the span's surplus: its last row, unless `hRule="exact"` fixes that
   * row at its authored box. Then nothing grows and the merged content is clipped at the
   * span bottom. The surplus never moves up to an earlier row.
   */
  const lastGrowableRow = (span: VMergeSpan): number | undefined =>
    rows[span.endRow]!.height.rule === 'exact' ? undefined : span.endRow;

  /**
   * The spans decided together with this one: every merge that starts in its head row AND
   * ends in its end row. They cover the same rows, so one plan detaches all their heads,
   * measures the rows without any of them and reserves the tallest head. Deciding them one
   * at a time left every head but the first sizing the head row, and the first span's rows
   * then carried that head's height a second time below it.
   *
   * A span whose last row is fixed is measured the same way: a head left in the head row
   * would size that row by its whole content, which none of the rows can then give back.
   * Each head the fixed rows cannot hold is clipped at the span bottom.
   */
  const groupOf = (span: VMergeSpan): readonly VMergeSpan[] => coextensive.get(span) ?? [span];

  const pendingOf = (span: VMergeSpan): ReadonlySet<string> =>
    new Set(groupOf(span).map((member) => member.headCellId));

  /** The tallest merged content in the span's group: what the shared rows have to hold. */
  const groupContentOf = (span: VMergeSpan, atYPt?: number): number => {
    let tallest = 0;
    for (const member of groupOf(span)) tallest = Math.max(tallest, contentOf(member, atYPt));
    return tallest;
  };

  const innerGroupsCache = new Map<VMergeSpan, readonly (readonly VMergeSpan[])[] | null>();

  /**
   * The merges that start under this span's head row and are decided with it, one group per
   * head row in row order, or `null` when the shape is declined.
   *
   * The walk reads every row up to the furthest end row seen so far, so a merge that starts
   * inside the decision and ends after it (a staircase) extends the decision to its own end
   * row. A head row whose merges end in different rows is declined: one span length per
   * head row is planned. So is a decision with more groups than `MAX_JOINT_MERGE_GROUPS`.
   */
  const innerGroupsOf = (span: VMergeSpan): readonly (readonly VMergeSpan[])[] | null => {
    const known = innerGroupsCache.get(span);
    if (known !== undefined) return known;
    const groups: (readonly VMergeSpan[])[] = [];
    let result: readonly (readonly VMergeSpan[])[] | null = groups;
    let lastRow = span.endRow;
    for (let rowIndex = span.headRow + 1; rowIndex <= lastRow; rowIndex += 1) {
      const group = spansByRow.get(rowIndex);
      if (group === undefined) continue;
      const endRow = group[0]!.endRow;
      if (
        group.some((member) => member.endRow !== endRow) ||
        groups.length + 1 >= MAX_JOINT_MERGE_GROUPS
      ) {
        result = null;
        break;
      }
      groups.push(group);
      lastRow = Math.max(lastRow, endRow);
    }
    innerGroupsCache.set(span, result);
    return result;
  };

  /**
   * Why a span with merges below its head cannot be decided jointly now, if it cannot: one
   * of those groups was already decided on its own, so its numbers belong to another walk.
   */
  const jointDeclined = (inner: readonly (readonly VMergeSpan[])[]): boolean =>
    inner.some((group) => acceptedHeadRows.has(group[0]!.headRow));

  interface JointGroup {
    readonly spans: readonly VMergeSpan[];
    readonly atYPt: number | undefined;
    /** Merged content taller than the group's rows, which cannot grow: see `clippedSpans`. */
    readonly clipped: boolean;
  }

  /**
   * The joint decision for a span with other merges below its head, computed without
   * changing the plan.
   *
   * One walk goes top to bottom over every row of the decision. Each row is measured once,
   * at the y the rows above it leave it at, with every head of the decision detached. When
   * the walk reaches the end row of a group, that row grows to what the group's tallest head
   * still needs below the group's rows above it, unless `hRule="exact"` fixes the row. So a
   * merge sees every surplus that an earlier merge put in its rows, and a staircase and a
   * nest resolve by the same rule.
   */
  const jointPlanOf = (
    span: VMergeSpan,
    inner: readonly (readonly VMergeSpan[])[],
    atYPt?: number
  ): {
    readonly groups: readonly JointGroup[];
    readonly floors: ReadonlyMap<number, number>;
    readonly surplus: ReadonlyMap<number, number>;
    readonly lastRow: number;
    readonly heightPt: number;
  } => {
    const all = [coextensive.get(span) ?? [span], ...inner];
    const pending = new Set<string>();
    const endingAt = new Map<number, (readonly VMergeSpan[])[]>();
    let lastRow = span.endRow;
    for (const group of all) {
      for (const member of group) pending.add(member.headCellId);
      const endRow = group[0]!.endRow;
      lastRow = Math.max(lastRow, endRow);
      const ending = endingAt.get(endRow);
      if (ending) ending.push(group);
      else endingAt.set(endRow, [group]);
    }
    const floors = new Map<number, number>();
    const surplus = new Map<number, number>();
    /** Each row's top below the decision's head row top. */
    const topOf = new Map<number, number>();
    const groups: JointGroup[] = [];
    let total = 0;
    for (let rowIndex = span.headRow; rowIndex <= lastRow; rowIndex += 1) {
      topOf.set(rowIndex, total);
      const base = floorOf(rowIndex, pending, atYPt === undefined ? undefined : atYPt + total);
      const ending = (endingAt.get(rowIndex) ?? []).map((group) => {
        const above = total - topOf.get(group[0]!.headRow)!;
        const top = atYPt === undefined ? undefined : atYPt + topOf.get(group[0]!.headRow)!;
        let content = 0;
        for (const member of group) content = Math.max(content, contentOf(member, top));
        return { group, top, above, content };
      });
      let floor = base;
      if (rows[rowIndex]!.height.rule !== 'exact') {
        for (const { above, content } of ending) {
          if (content - above - floor > EPSILON_PT) floor = content - above;
        }
      }
      if (floor > base) surplus.set(rowIndex, floor - base);
      floors.set(rowIndex, floor);
      total += floor;
      for (const { group, top, above, content } of ending) {
        groups.push({ spans: group, atYPt: top, clipped: content > above + floor + EPSILON_PT });
      }
    }
    return { groups, floors, surplus, lastRow, heightPt: total };
  };

  /** Take a joint decision into the plan; see `jointPlanOf`. */
  const acceptJoint = (
    span: VMergeSpan,
    inner: readonly (readonly VMergeSpan[])[],
    atYPt?: number
  ): void => {
    const { groups, floors, surplus, lastRow } = jointPlanOf(span, inner, atYPt);
    const members: VMergeSpan[] = [];
    for (const group of groups) {
      for (const member of group.spans) {
        members.push(member);
        acceptedSpans.add(member);
        acceptedHeadIds.add(member.headCellId);
        admittedAtYPt.set(member, group.atYPt);
        if (group.clipped) clippedSpans.add(member);
      }
      acceptedHeadRows.add(group.spans[0]!.headRow);
    }
    for (const [rowIndex, grown] of surplus) {
      surplusPt.set(rowIndex, (surplusPt.get(rowIndex) ?? 0) + grown);
    }
    const joint = { headRow: span.headRow, lastRow, members };
    for (const member of members) jointOf.set(member, joint);
    for (const [rowIndex, floor] of floors) {
      coveredRows.add(rowIndex);
      plannedFloorPt.set(rowIndex, Math.max(plannedFloorPt.get(rowIndex) ?? 0, floor));
      if (rowIndex > span.headRow) heldRows.add(rowIndex);
    }
  };

  /**
   * What the span's rows add up to. Each row is measured at the y the ones above it leave
   * it at, so a wrap band is applied to the rows it really crosses — measuring them all at
   * the head's top would put every band over every row.
   */
  const coveredPtOf = (span: VMergeSpan, atYPt?: number): number => {
    const pending = pendingOf(span);
    let total = 0;
    for (let rowIndex = span.headRow; rowIndex <= span.endRow; rowIndex += 1) {
      total += floorOf(rowIndex, pending, atYPt === undefined ? undefined : atYPt + total);
    }
    return total;
  };

  /**
   * The same walk, keeping each row's own share.
   *
   * The surplus is `head content − what the rows cover`, and both sides of that subtraction
   * are measured at the y the rows will sit at, bands included. The floor handed to the
   * placer has to come from the SAME measurement: hand out a position-free base plus a
   * positioned surplus and a band that makes a row place taller than its position-free probe
   * absorbs the floor instead of adding to it, so the rows fall short of the head's bound and
   * the difference paints below the table.
   */
  const coveredFloorsOf = (span: VMergeSpan, atYPt?: number): Map<number, number> => {
    const pending = pendingOf(span);
    const floors = new Map<number, number>();
    let total = 0;
    for (let rowIndex = span.headRow; rowIndex <= span.endRow; rowIndex += 1) {
      const floor = floorOf(rowIndex, pending, atYPt === undefined ? undefined : atYPt + total);
      floors.set(rowIndex, floor);
      total += floor;
    }
    return floors;
  };

  const spanHeightOf = (span: VMergeSpan, atYPt?: number): number => {
    // Shapes this module declines read as "taller than any page", so the caller never
    // admits them and never probes for a height it will not use.
    if (!acceptedSpans.has(span)) {
      const inner = innerGroupsOf(span);
      if (inner === null || acceptedHeadRows.has(span.headRow)) return Number.POSITIVE_INFINITY;
      if (inner.length > 0) {
        return jointDeclined(inner)
          ? Number.POSITIVE_INFINITY
          : jointPlanOf(span, inner, atYPt).heightPt;
      }
    }
    // Accepted, or with nothing below its head: the rows as the plan now has them.
    const covered = coveredPtOf(span, atYPt);
    if (lastGrowableRow(span) === undefined) return covered;
    return Math.max(covered, groupContentOf(span, atYPt));
  };

  return {
    spansAt: (rowIndex) => spansByRow.get(rowIndex) ?? [],
    heightOf: spanHeightOf,
    accept: (span, atYPt) => {
      if (acceptedSpans.has(span)) return;
      const inner = innerGroupsOf(span);
      if (inner === null || acceptedHeadRows.has(span.headRow)) return;
      if (inner.length > 0) {
        if (!jointDeclined(inner)) acceptJoint(span, inner, atYPt);
        return;
      }
      const rowFloors = coveredFloorsOf(span, atYPt);
      let covered = 0;
      for (const floor of rowFloors.values()) covered += floor;
      const growable = lastGrowableRow(span);
      const contentHeightPt = groupContentOf(span, atYPt);
      const surplus = growable === undefined ? 0 : contentHeightPt - covered;
      // For growable spans, the whole group joins: the floors were measured with each of its
      // heads out of the head row, so admitting only some would leave the rest sizing a row
      // those floors do not describe.
      // Over a fixed last row every head of the same rows joins too, and for the same reason.
      // A head the rows cannot hold is clipped at the span bottom.
      const group =
        growable === undefined
          ? (coextensive.get(span) ?? [span]).filter(
              (member) => member === span || !acceptedSpans.has(member)
            )
          : groupOf(span);
      for (const member of group) {
        acceptedSpans.add(member);
        acceptedHeadIds.add(member.headCellId);
        // Each head's own content: the group's tallest head says nothing about a short one.
        const content = contentOf(member, atYPt);
        if (growable === undefined && content > covered + EPSILON_PT) clippedSpans.add(member);
      }
      acceptedHeadRows.add(span.headRow);
      if (surplus > EPSILON_PT) {
        surplusPt.set(growable!, (surplusPt.get(growable!) ?? 0) + surplus);
        rowFloors.set(growable!, (rowFloors.get(growable!) ?? 0) + surplus);
      }
      for (const [rowIndex, floor] of rowFloors) {
        coveredRows.add(rowIndex);
        // What the span was admitted on IS what the placer is told to leave room for.
        plannedFloorPt.set(rowIndex, Math.max(plannedFloorPt.get(rowIndex) ?? 0, floor));
        if (rowIndex > span.headRow) heldRows.add(rowIndex);
      }
      // The span's height is NOT stored here. `rowOptions` derives it from the same cached
      // measurements when the row is placed, so a height captured under one set of detached
      // heads can never outlive it. Every head that detaches from this row joined above, in
      // the same decision, which is what keeps that derivation equal to these floors.
      for (const member of group) {
        admittedAtYPt.set(member, atYPt);
        surplusRow.set(member, surplus > EPSILON_PT ? growable! : undefined);
      }
    },
    withdrawAt: (rowIndex) => {
      const release = (span: VMergeSpan): void => {
        acceptedSpans.delete(span);
        acceptedHeadIds.delete(span.headCellId);
        acceptedHeadRows.delete(span.headRow);
        clippedSpans.delete(span);
        admittedAtYPt.delete(span);
        surplusRow.delete(span);
        jointOf.delete(span);
      };
      for (const span of spansByRow.get(rowIndex) ?? []) {
        if (!acceptedSpans.has(span)) continue;
        const joint = jointOf.get(span);
        const members = joint?.members;
        // A head below the first head row only stops detaching; see `withdrawAt` above.
        if (joint !== undefined && joint.headRow !== rowIndex) {
          release(span);
          continue;
        }
        const grew = surplusRow.get(span);
        if (grew !== undefined) surplusPt.delete(grew);
        for (const member of members ?? [span]) release(member);
        for (let row = span.headRow; row <= (joint?.lastRow ?? span.endRow); row += 1) {
          // A joint decision is the only one covering its rows, every surplus included.
          if (members !== undefined) surplusPt.delete(row);
          coveredRows.delete(row);
          plannedFloorPt.delete(row);
          heldRows.delete(row);
        }
      }
    },
    rowOptions: (rowIndex) => {
      if (!coveredRows.has(rowIndex)) return undefined;
      // Derived now, not at accept: every span heading this row has been decided by the
      // time the row is placed, so this is the first moment the heights are all settled.
      let detachedSpanHeightPtByCellId: Map<string, number> | undefined;
      let clippedSpanCellIds: Set<string> | undefined;
      for (const span of spansByRow.get(rowIndex) ?? []) {
        if (!acceptedSpans.has(span)) continue;
        detachedSpanHeightPtByCellId ??= new Map<string, number>();
        detachedSpanHeightPtByCellId.set(
          span.headCellId,
          spanHeightOf(span, admittedAtYPt.get(span))
        );
        if (clippedSpans.has(span)) (clippedSpanCellIds ??= new Set()).add(span.headCellId);
      }
      // The floor recorded when the span was admitted, in the same measurement space the
      // surplus was taken from. `floorOf` is the fallback for a covered row no accepted span
      // recorded, which only a decline can leave behind.
      return {
        ...(detachedSpanHeightPtByCellId ? { detachedSpanHeightPtByCellId } : {}),
        heightFloorPt: plannedFloorPt.get(rowIndex) ?? floorOf(rowIndex),
        ...(heldRows.has(rowIndex) ? { coveredFromAbove: true } : {}),
        ...(clippedSpanCellIds ? { clippedSpanCellIds } : {}),
      };
    },
  };
}

/**
 * Take every merge that starts at `rowIndex` and fits between `rowTopPt` and
 * `contentBottomPt`, and return this row's placement options.
 *
 * The fit is judged where the row is ACTUALLY about to be placed, which is why this is
 * called from the placing loop rather than planned up front: a page break re-emits repeated
 * header rows and can open a page with a shorter content box. It never breaks a page of its
 * own — the caller's whole-row move does that, and calls again on the fresh page, where a
 * merge that did not fit before may fit now. A merge that still does not fit is simply not
 * taken, which leaves it on the row-by-row path where the row-split machinery paginates it
 * exactly as it did before.
 */
export function admitVMergeSpansAt(
  plan: VMergeRowHeights | null,
  rowIndex: number,
  rowTopPt: number,
  contentBottomPt: number
): RowVMergeLayoutOptions | undefined {
  for (const span of plan?.spansAt(rowIndex) ?? []) {
    if (rowTopPt + plan!.heightOf(span, rowTopPt) > contentBottomPt + EPSILON_PT) continue;
    plan!.accept(span, rowTopPt);
  }
  return plan?.rowOptions(rowIndex);
}

/**
 * {@link planVMergeRowHeights} for a whole resolved structure, for the callers that place
 * every row of a table in one pass (a nested table, a header/footer story).
 *
 * `measure` is the row-height probe, taken as an argument rather than imported: the probe
 * lives with row layout, and this module stays free of that dependency.
 */
export function planTableVMergeHeights<Deps>(
  structure: SemanticTableStructure,
  /** A getter where the caller moves the table between rows; a number where it cannot. */
  left: number | (() => number),
  depth: number,
  deps: Deps,
  measure: (
    row: SemanticTableRow,
    cols: readonly number[],
    left: number,
    depth: number,
    deps: Deps,
    cellSpacingPt?: number,
    vMerge?: RowVMergeLayoutOptions,
    atYPt?: number
  ) => number,
  /** Include occurrence-dependent insets in height-cache keys (outer versus shared top). */
  probeContext?: (row: SemanticTableRow) => string
): VMergeRowHeights | null {
  return planVMergeRowHeights(
    structure.rows,
    (row, detached, atYPt) =>
      measure(
        row,
        structure.columnWidthsPt,
        typeof left === 'function' ? left() : left,
        depth,
        deps,
        structure.cellSpacingPt,
        // A probe only needs to know WHICH cells are out: the span it measures towards has
        // no height of its own yet, and being unbounded is the point of a probe.
        detached
          ? {
              detachedSpanHeightPtByCellId: new Map(
                [...detached].map((id) => [id, Number.POSITIVE_INFINITY])
              ),
            }
          : undefined,
        atYPt
      ),
    probeContext
  );
}

/**
 * Accept every merge starting at `rowIndex` for a table placed in one pass, where there is
 * no page to fall off and so no fit to judge.
 *
 * `rowTopPt` is where the row is going, and it matters for the same reason it does in the
 * paginator: the head's bound comes from this measurement, and a one-pass caller has no
 * continuation to carry what a bound cut short. Measuring position-free here and placing
 * under a wrap band there would drop the lines the band pushed past the span.
 */
export function acceptVMergeSpansAt(
  plan: VMergeRowHeights | null,
  rowIndex: number,
  rowTopPt: number
): RowVMergeLayoutOptions | undefined {
  for (const span of plan?.spansAt(rowIndex) ?? []) plan!.accept(span, rowTopPt);
  return plan?.rowOptions(rowIndex);
}
