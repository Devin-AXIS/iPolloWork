/**
 * How an autofit table shares its width among columns that its cells size by content, and
 * how a cell spanning several columns widens them. Pure arithmetic over points; the cell
 * measuring lives in `table-autofit-widths.ts`.
 */

import { MAX_COLUMN_WIDTH_PT, type PreferredWidth } from './table-widths.ts';

const EPSILON_PT = 0.01;
/** No column collapses below a hairline, whatever its content. */
export const MIN_COLUMN_PT = 1;
/** The most content a column counts once minimums overflow: the widest a page can be. */
const MAX_CONTENT_PT = MAX_COLUMN_WIDTH_PT;
/**
 * Column minimums, each at least a hairline, settled into `room`.
 *
 * Minimums that fit come back as they are. Otherwise each column keeps its content insets
 * whole, and at least a hairline. What its content needs beyond them, counted as no more than
 * the widest a page can be, narrows by one factor shared by every column, and no column grows
 * past its minimum. One unbreakable word therefore takes the same share from every column
 * instead of collapsing the others. Insets that alone do not fit scale above the hairlines. A
 * room that is not finite keeps the minimums.
 */
export function fitMinimumsToRoom(
  minimums: readonly number[],
  room: number,
  /** Each column's horizontal content insets; pass `[]` to keep only hairlines. */
  insets: readonly number[]
): readonly number[] {
  const floor = minimums.map((minimum) => Math.max(minimum, MIN_COLUMN_PT));
  const needed = floor.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(room) || needed <= room) return floor;
  const kept = floor.map((minimum, column) =>
    Math.min(minimum, Math.max(MIN_COLUMN_PT, insets[column] ?? 0))
  );
  const content = floor.map((minimum, column) => Math.min(minimum - kept[column]!, MAX_CONTENT_PT));
  let keptPt = 0;
  let contentPt = 0;
  for (let column = 0; column < floor.length; column++) {
    keptPt += kept[column]!;
    contentPt += content[column]!;
  }
  if (keptPt < room && contentPt > EPSILON_PT) {
    let scale = (room - keptPt) / contentPt;
    if (scale > 1) {
      // Content counted whole reaches its minimum; the content past the widest page shares
      // the room that leaves.
      let rest = room;
      let cappedPt = 0;
      for (let column = 0; column < floor.length; column++) {
        if (kept[column]! + content[column]! < floor[column]!) {
          rest -= kept[column]!;
          cappedPt += content[column]!;
        } else rest -= floor[column]!;
      }
      scale = cappedPt > EPSILON_PT ? rest / cappedPt : 1;
    }
    return kept.map((width, column) => Math.min(floor[column]!, width + content[column]! * scale));
  }
  // Scale only what each column holds above its hairline, so every hairline survives whole.
  const hairlines = floor.length * MIN_COLUMN_PT;
  const scale = Math.max(0, room - hairlines) / Math.max(keptPt - hairlines, EPSILON_PT);
  return kept.map((width) => MIN_COLUMN_PT + (width - MIN_COLUMN_PT) * scale);
}

/** What a cell spanning `count` columns from `from` needs across them, in points. */
export interface SpanRequirement {
  readonly from: number;
  readonly count: number;
  readonly minimum: number;
  /** The requirement with the insets the cell has now, before any widening. */
  readonly current?: number;
}

/**
 * Column minimums raised so every spanning cell's content fits the columns it spans.
 *
 * A spanned group that already holds the cell keeps its minimums. Otherwise the group settles
 * at exactly the cell's minimum, shared in proportion to each column's preferred width (at
 * least its minimum) plus its widest content; a column whose share falls below its own minimum
 * keeps that and the rest share what remains. Narrower spans settle first, so a wider one sees
 * the columns they raised.
 */
export function spanAdjustedMinimums(
  widths: readonly number[],
  minimums: readonly number[],
  maximums: readonly number[],
  spans: readonly SpanRequirement[]
): readonly number[] {
  if (spans.length === 0) return minimums;
  const raised = [...minimums];
  for (const span of [...spans].sort((a, b) => a.count - b.count)) {
    const columns: number[] = [];
    for (
      let column = span.from;
      column < span.from + span.count && column < raised.length;
      column++
    )
      columns.push(column);
    if (columns.length < 2) continue;
    let held = 0;
    for (const column of columns) held += Math.max(widths[column]!, raised[column]!);
    // Exact: a span short by a rounding hair still breaks its text inside the cell.
    if (span.minimum <= held) continue;
    const weightOf = (column: number): number =>
      Math.max(widths[column]!, raised[column]!) + Math.max(maximums[column]!, raised[column]!);
    const pinned = new Set<number>();
    for (;;) {
      let remaining = span.minimum;
      let weight = 0;
      for (const column of columns) {
        if (pinned.has(column)) remaining -= raised[column]!;
        else weight += weightOf(column);
      }
      const shareOf = (column: number): number =>
        weight > 0
          ? (remaining * weightOf(column)) / weight
          : remaining / (columns.length - pinned.size);
      const short = columns.filter(
        (column) => !pinned.has(column) && shareOf(column) < raised[column]! - EPSILON_PT
      );
      if (short.length > 0 && pinned.size + short.length < columns.length) {
        for (const column of short) pinned.add(column);
        continue;
      }
      for (const column of columns)
        if (!pinned.has(column)) raised[column] = Math.max(raised[column]!, shareOf(column));
      break;
    }
  }
  return raised;
}

/**
 * Column widths for an autofit table some of whose columns no cell gives a preferred width.
 *
 * Those columns are sized by content: each holds its widest unwrapped line when the table
 * has room, and room beyond that is shared in proportion to those widths. Columns with a
 * preferred width keep it while the content-sized ones get their widest lines; past that they
 * give way down to their minimums, and then the content-sized columns wrap, each moving from
 * its minimum toward its widest line by the same fraction. A table whose minimums do not fit
 * its room narrows their content alike (see {@link fitMinimumsToRoom}).
 *
 * `targetPt` is the table's settled width; for a table with no width of its own, pass
 * `undefined` and it takes what its content asks for, up to `availablePt`.
 */
export function contentSizedWidths(
  widths: readonly number[],
  sizedByContent: readonly boolean[],
  minimums: readonly number[],
  maximums: readonly number[],
  targetPt: number | undefined,
  availablePt: number,
  {
    currentPt = 0,
    insets,
  }: {
    /** What the table measured before; overflowing minimums never fit into less than this. */
    readonly currentPt?: number;
    /** Each column's content insets, which overflowing minimums keep whole. */
    readonly insets: readonly number[];
  }
): readonly number[] {
  const count = widths.length;
  const result = new Array<number>(count);
  let preferred = 0;
  let preferredFloor = 0;
  let widest = 0;
  let narrowest = 0;
  for (let index = 0; index < count; index++) {
    const minimum = Math.max(minimums[index]!, MIN_COLUMN_PT);
    if (sizedByContent[index]) {
      widest += Math.max(maximums[index]!, minimum);
      narrowest += minimum;
    } else {
      preferred += Math.max(widths[index]!, minimum);
      preferredFloor += minimum;
    }
  }
  const target = targetPt ?? Math.min(preferred + widest, availablePt);
  if (preferred + widest <= target + EPSILON_PT) {
    // Every column fits; the content-sized ones share the room left, by their widest lines.
    const extra = target - preferred - widest;
    for (let index = 0; index < count; index++) {
      const minimum = Math.max(minimums[index]!, MIN_COLUMN_PT);
      if (!sizedByContent[index]) {
        result[index] = Math.max(widths[index]!, minimum);
        continue;
      }
      const max = Math.max(maximums[index]!, minimum);
      result[index] = widest > 0 ? max + (extra * max) / widest : max;
    }
    return result;
  }
  if (preferredFloor + widest <= target + EPSILON_PT) {
    // Content-sized columns keep their widest lines; preferred ones give way by their slack.
    const need = preferred + widest - target;
    let slack = 0;
    for (let index = 0; index < count; index++) {
      if (sizedByContent[index]) continue;
      const minimum = Math.max(minimums[index]!, MIN_COLUMN_PT);
      slack += Math.max(widths[index]!, minimum) - minimum;
    }
    for (let index = 0; index < count; index++) {
      const minimum = Math.max(minimums[index]!, MIN_COLUMN_PT);
      if (sizedByContent[index]) {
        result[index] = Math.max(maximums[index]!, minimum);
        continue;
      }
      const width = Math.max(widths[index]!, minimum);
      result[index] = slack > 0 ? width - (need * (width - minimum)) / slack : width;
    }
    return result;
  }
  const room = target - preferredFloor;
  if (room >= narrowest - EPSILON_PT) {
    // Preferred columns at their minimums; content-sized ones wrap by the same fraction.
    const fraction = widest > narrowest ? (room - narrowest) / (widest - narrowest) : 0;
    for (let index = 0; index < count; index++) {
      const minimum = Math.max(minimums[index]!, MIN_COLUMN_PT);
      result[index] = sizedByContent[index]
        ? minimum + (Math.max(maximums[index]!, minimum) - minimum) * fraction
        : minimum;
    }
    return result;
  }
  // The minimums alone overflow. Never narrower than the table already was: an indent can
  // leave the text column no room.
  return fitMinimumsToRoom(minimums, Math.max(target, availablePt, currentPt), insets);
}

/**
 * Settle an autofit table whose every column has a preferred width.
 *
 * Each column starts at its preferred width, raised to its minimum. A table that is then
 * wider than `targetPt` gives back the difference in proportion to how far each column sits
 * above its minimum, so a column whose content needs little keeps less of its preference than
 * a column whose content needs much. A `stretch` table narrower than its target grows every
 * column in proportion to its width. When the minimums alone are wider than the target, the
 * table keeps them up to `roomPt`, and narrows them into the room past it (see
 * {@link fitMinimumsToRoom}).
 */
export function spreadPreferredColumns(
  preferred: readonly number[],
  minimums: readonly number[],
  targetPt: number,
  roomPt: number,
  {
    stretch,
    insets,
  }: {
    readonly stretch: boolean;
    /** Each column's content insets, which overflowing minimums keep whole. */
    readonly insets: readonly number[];
  }
): readonly number[] {
  const floor = minimums.map((minimum) => Math.max(minimum, MIN_COLUMN_PT));
  const grown = preferred.map((width, index) => Math.max(width, floor[index]!));
  const total = grown.reduce((sum, width) => sum + width, 0);
  if (!Number.isFinite(total) || !Number.isFinite(targetPt) || targetPt < 0) return grown;
  if (total < targetPt - EPSILON_PT)
    return stretch ? grown.map((width) => (width * targetPt) / total) : grown;
  const need = total - targetPt;
  if (need <= EPSILON_PT) return grown;
  const slack = grown.map((width, index) => width - floor[index]!);
  const totalSlack = slack.reduce((sum, value) => sum + value, 0);
  if (need <= totalSlack)
    return grown.map((width, index) => width - (need * slack[index]!) / totalSlack);
  return fitMinimumsToRoom(minimums, Math.max(targetPt, roomPt), insets);
}

/**
 * Widen the columns of a table whose every column has a percentage preferred width.
 *
 * A column narrower than its minimum grows to it, and every other column gives up an equal
 * part of what they grew by, whatever its width or content. Then, from the first column to
 * the last, a column that the equal part takes below its minimum keeps the minimum, and the
 * next column that gives way gives up the difference as well. Returns `undefined` when no
 * column widens, or when the last columns cannot give up what the earlier ones need.
 */
export function equalShareWidenedWidths(
  widths: readonly number[],
  minimums: readonly number[]
): readonly number[] | undefined {
  const floor = minimums.map((minimum) => Math.max(minimum, MIN_COLUMN_PT));
  let gain = 0;
  let givers = 0;
  const widens = widths.map((width, index) => {
    const grows = width < floor[index]! - EPSILON_PT;
    if (grows) gain += floor[index]! - width;
    else givers++;
    return grows;
  });
  if (gain <= EPSILON_PT || givers === 0) return undefined;
  const share = gain / givers;
  let carry = 0;
  const result = widths.map((width, index) => {
    if (widens[index]) return floor[index]!;
    const settled = width - share - carry;
    carry = Math.max(0, floor[index]! - settled);
    return Math.max(settled, floor[index]!);
  });
  return carry > EPSILON_PT ? undefined : result;
}

/** Widths that match the resolved ones come back by identity, so the shared base stays. */
export function sameOrComputed(
  structure: { readonly columnWidthsPt: readonly number[] },
  computed: readonly number[]
): readonly number[] {
  return computed.every(
    (width, column) => Math.abs(width - structure.columnWidthsPt[column]!) <= EPSILON_PT
  )
    ? structure.columnWidthsPt
    : computed;
}

/**
 * Widen autofit columns that are narrower than their minimum.
 *
 * A column below its minimum grows to it, and the table settles at `targetPt`: its own width
 * for an absolute `w:tblW`, the room it has in the text column for an automatic width, its
 * share of that room for a percentage. A table already narrower than an automatic target
 * grows only as far as its content needs. The other columns give the difference in
 * proportion to how far each one sits above its own minimum. When they reach their minimums,
 * the table grows past its target; when the minimums together are wider than `availablePt`,
 * their content narrows alike (see {@link fitMinimumsToRoom}). Widths that already
 * hold their content come back unchanged, by identity.
 */
export function widenAutofitColumns(
  widths: readonly number[],
  minimums: readonly number[],
  targetPt: number,
  availablePt: number,
  {
    shrinkToTarget = false,
    insets,
  }: {
    /** Also bring a table wider than `targetPt` down to it when no column widens. */
    readonly shrinkToTarget?: boolean;
    /** Each column's content insets, which overflowing minimums keep whole. */
    readonly insets: readonly number[];
  }
): readonly number[] {
  let deficit = 0;
  let total = 0;
  for (const [index, width] of widths.entries()) {
    deficit += Math.max(0, minimums[index]! - width);
    total += width;
  }
  if (deficit <= EPSILON_PT && !(shrinkToTarget && total > targetPt + EPSILON_PT)) return widths;
  // Nothing widens: every column gives way in proportion to its width.
  if (deficit <= EPSILON_PT) return widths.map((width) => (width * targetPt) / total);
  const grown = widths.map((width, index) => Math.max(width, minimums[index]!));
  const need = grown.reduce((sum, width) => sum + width, 0) - targetPt;
  if (need <= EPSILON_PT) return grown;
  // No column gives up its last hairline.
  const slack = widths.map((width, index) =>
    Math.max(0, width - Math.max(minimums[index]!, MIN_COLUMN_PT))
  );
  const totalSlack = slack.reduce((sum, value) => sum + value, 0);
  if (need <= totalSlack) {
    return grown.map((width, index) => width - (need * slack[index]!) / totalSlack);
  }
  // Every column keeps a hairline: a zero-width column would give its cell no box at all.
  // Never narrower than the table already was: an indent can leave the text column no room.
  return fitMinimumsToRoom(minimums, Math.max(availablePt, total), insets);
}

/** The total an autofit table settles at once a column has to widen, in points. */
export function autofitTargetPt(
  tableWidth: PreferredWidth,
  totalPt: number,
  availablePt: number,
  legacyContentAlignment = false,
  /** What a percentage is a share of: the text column, as the width resolver reads it. */
  percentBasisPt = availablePt
): number {
  // A legacy content-aligned table already spans the text column plus its outer margins.
  if (legacyContentAlignment) return totalPt;
  if (tableWidth.type === 'dxa' && tableWidth.value > 0) return totalPt;
  if (tableWidth.type === 'pct' && tableWidth.value > 0)
    // Never below the resolved total, so a column widening by a little never narrows the table.
    return Math.max(totalPt, Math.min(availablePt, (percentBasisPt * tableWidth.value) / 100));
  return availablePt;
}
