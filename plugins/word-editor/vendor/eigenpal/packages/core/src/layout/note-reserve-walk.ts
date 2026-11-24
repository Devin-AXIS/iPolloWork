// The footnote reserve search, one page at a time.
//
// A page's footnote reserve and its body decide each other: the reserve sets how much body
// the page holds, and the body sets which references, and so which notes, the page holds.
// More than one reserve can agree with its own body, and some pages have no reserve that
// does. A search that adopts every page's reserve at once therefore ends on an answer that
// depends on where it started, so a document laid out after an edit could differ from the
// same document opened fresh.
//
// This search decides the pages in order. Each page starts from no reserve and follows its
// own need until the need repeats. When the page reaches a cycle instead, it takes the
// smallest reserve in the cycle that leaves its notes room, or the largest one when none
// does. A decided page does not change again. Its answer depends only on the decided pages
// before it, its own content, and the opening of the next page, so the walk gives the same
// answer from any start.
//
// An edit keeps the decisions on the pages before it and walks on from there. Once the walk
// reaches a page that starts exactly where a page of the previous walk started, with the same
// notes carried in and the same content after it, the previous decisions from that page on
// are the ones this walk would make, and the walk takes them.

import type { LayoutSteps } from './layout-steps.ts';
import type { PageRecord, SemanticLayout } from './semantic-records.ts';

type Reserves = ReadonlyMap<number, number>;

/**
 * Where a reserve computation starts: a page index and the notes carried into it. With `to`,
 * it stops before that page position; the pages before it get the answers a computation to
 * the end gives them, as each page reads only the notes carried into it and the pages after.
 */
export interface ReserveComputeRange {
  readonly from: number;
  readonly carry: unknown;
  readonly to?: number;
}

/** Pages one computation of the walk covers from the page being decided; see `computeNear`. */
const COMPUTE_SPAN = 8;

/**
 * Pages from the decided one that its answer reads: itself, the next page, and the one after
 * a blank parity sheet. The walk computes again before the decided page comes this close to
 * the end of what it computed.
 */
const COMPUTE_READS = 3;

/** What one reserve computation returns, for the pages from its range on. */
export interface ReserveComputeResult {
  readonly reserves: Reserves;
  readonly stable: boolean;
  readonly reasons: readonly import('./note-pagination.ts').NotePaginationFallbackReason[];
  /** Any reference sits on an orphan pair. */
  readonly orphanCandidates: boolean;
  /** The page indices whose references sit on an orphan pair. */
  readonly orphanPages: ReadonlySet<number>;
  /** By page position: the notes carried into that page. */
  readonly carryBefore: readonly unknown[];
}

/** The decisions a walk made, kept for the next pass. */
export interface ReserveWalkRecord {
  /** Decided reserves, by page index. */
  readonly reserves: Reserves;
  /** Pages `[0, decided)` are decided. */
  readonly decided: number;
  /** Whether the walk reached the end of the document. */
  readonly complete: boolean;
  /** By page index: where the page starts and what notes it carries in. */
  readonly starts: readonly string[];
  /** By page index: the notes carried into the page, as the computation reads them. */
  readonly carries: readonly unknown[];
}

/** Pages a cycle may run through on one page before the page takes an answer. */
export const MAX_PAGE_RESERVE_ROUNDS = 8;

/** A walk round: the body laid out with `reserves`, complete through page `throughPage`. */
export interface ReserveWalkRound {
  readonly layout: SemanticLayout;
  /** Whether the layout holds the whole document. */
  readonly whole: boolean;
}

export interface ReserveWalkOptions {
  /** Decided reserves and starts before `floor`, and the notes carried into it. */
  readonly start: {
    readonly reserves: Reserves;
    readonly floor: number;
    readonly carry: unknown;
    readonly starts: readonly string[];
    readonly carries: readonly unknown[];
  };
  /** The previous walk, and the first page of its layout whose content this pass keeps. */
  readonly previous?: {
    readonly record: ReserveWalkRecord;
    /** Previous page index from which pages hold unchanged content. */
    readonly unchangedFrom: number;
  };
  /**
   * Lay out with `reserves`, so that pages through `throughPage` are complete. A round may
   * stop short of that once pages through `neededPage` are complete: the walk decides the
   * pages it can and asks for more.
   */
  readonly round: (
    reserves: Reserves,
    throughPage: number,
    neededPage: number
  ) => LayoutSteps<ReserveWalkRound>;
  /**
   * Whether a round after a new reserve also lays out further, as a round after a decided
   * page does. Set when rounds end at section ends: the round then lays out the decided page
   * again and the next section, so the next note page's search starts in that round. Without
   * section ends the pages past the decided one move with its reserve, so laying them out
   * before the reserve holds costs more than the round it saves.
   */
  readonly growAfterReserve?: boolean;
  /**
   * Some section starts on an odd or even page. The previous walk's pages after a matching
   * start then apply only when they move by an even number of pages: an odd move turns each
   * odd page even, so a blank sheet the previous walk made falls elsewhere or not at all.
   */
  readonly parityStarts?: boolean;
  /**
   * The reserves `layout` needs from `range.from` on. It reads `used` only for the pages in
   * the range: the walk may pass just those.
   */
  readonly compute: (
    layout: SemanticLayout,
    used: Reserves,
    allowOrphanDeferral: boolean,
    range: ReserveComputeRange
  ) => ReserveComputeResult;
  /**
   * The start signature of a page with the notes carried into it; empty when the page start
   * names no one place, which keeps the page out of the shortcut.
   */
  readonly startOf: (page: PageRecord, carry: unknown) => string;
  /** True when a newer edit replaces this pass. */
  readonly stopped: () => boolean;
  /**
   * False to decide every page from rounds without tries (see `Tried`). The answers are the
   * same either way; tests compare the two.
   */
  readonly tryAhead?: boolean;
  /**
   * Whether `page` likely keeps its body with `reserve`: the walk tries pages ahead only past
   * a page that does. A wrong guess costs a round, never an answer. Absent, every page does.
   */
  readonly keepsBody?: (page: PageRecord, reserve: number) => boolean;
}

export interface ReserveWalkResult {
  readonly reserves: Reserves;
  readonly record: ReserveWalkRecord;
  /** Some page took a cycle answer, or the walk stopped early. */
  readonly exhausted: boolean;
  /** The last round's layout, and whether it was laid out under `reserves`. */
  readonly last: ReserveWalkRound | null;
  readonly lastCurrent: boolean;
}

/**
 * Pages beyond the decided one that a round must complete: the decided page reads the next
 * page's opening, and the one after it when the next page is a blank parity sheet.
 */
const LOOKAHEAD_PAGES = 3;

/**
 * The most pages past the decided one that a round lays out, while the walk is near a new
 * reserve. A round that decides every page it holds without a new reserve lays out twice as
 * far the next time, up to this limit or the pages decided since the last new reserve, if
 * more: the pages between note pages cost a few rounds rather than one round for each page,
 * and a long stretch without notes costs rounds that double, not one round per 16 pages. See
 * `growAfterReserve` for a round after a new reserve.
 */
const MAX_ROUND_PAGES = 16;

/** The reserve one page settles on when its need cycles. */
function cycleAnswer(seen: ReadonlyMap<number, number>, fallback: number | undefined): number {
  if (fallback !== undefined) return fallback;
  let smallestStable: number | undefined;
  let largest = 0;
  for (const [reserve, need] of seen) {
    if (need <= reserve + 0.001 && (smallestStable === undefined || reserve < smallestStable)) {
      smallestStable = reserve;
    }
    largest = Math.max(largest, reserve, need);
  }
  return smallestStable ?? largest;
}

function withReserve(reserves: Reserves, page: number, value: number): Map<number, number> {
  const next = new Map<number, number>();
  for (const [index, height] of reserves) if (index !== page) next.set(index, height);
  if (value > 0) next.set(page, value);
  return next;
}

/** `reserves` on the pages through index `through`. */
function kept(reserves: Reserves, through: number): Map<number, number> {
  const next = new Map<number, number>();
  for (const [index, height] of reserves) if (index <= through) next.set(index, height);
  return next;
}

/**
 * Pages a new reserve's round tries, by page position, and the round they come from.
 *
 * Deciding a page takes a round with its reserve, and that round is also where the walk
 * reads the next page with no reserve. Where reserves do not move the pages after them, as
 * on pages that end at a page break, a page with a note on it costs one round each. The walk
 * then tries ahead: the round for a new reserve also takes the reserves the same computation
 * gives the next few pages. It still decides each page from the layout the walk without
 * tries reads, which is this round through the page and `base` after it, the pages there
 * laid out with no reserve. That holds while each page starts at the same place in both, as
 * a page depends only on where it starts and on the reserves through it. The first page that
 * does not, or the first tried reserve that is not the page's first need, ends the tries:
 * the walk lays out the round it lays out without them.
 */
interface Tried {
  /** Position -> tried reserve, for pages past the decided one. */
  readonly values: ReadonlyMap<number, number>;
  /** The last tried position. */
  readonly last: number;
  /** The last tried page likely moves its body, so no page after it is tried. */
  readonly moves: boolean;
  /** Tried positions whose first need was their tried reserve. */
  readonly met: Set<number>;
  /** The layout the tries were computed from: no reserve from the decided page on. */
  readonly base: SemanticLayout;
  /** Pages `[0, reliable)` of `base` are complete enough to decide. */
  readonly reliable: number;
}

/** The pages after `floor` a new reserve's round tries, or null when none needs one. */
function tryAhead(
  computed: ReserveComputeResult,
  pages: readonly PageRecord[],
  floor: number,
  limit: number,
  base: SemanticLayout,
  reliable: number,
  keepsBody: (page: PageRecord, reserve: number) => boolean
): Tried | null {
  const values = new Map<number, number>();
  let last = -1;
  let moves = false;
  for (let position = floor + 1; position < limit; position += 1) {
    const height = computed.reserves.get(pages[position]!.index) ?? 0;
    if (height <= 0) continue;
    values.set(position, height);
    last = position;
    // The pages after one that moves its body are not where the tries read them.
    moves = !keepsBody(pages[position]!, height);
    if (moves) break;
  }
  return last < 0 ? null : { values, last, moves, met: new Set(), base, reliable };
}

/** The carry two pages are compared with when only their bodies matter. */
const NO_CARRY: ReadonlyMap<string, unknown> = new Map();

/** A page's anchored drawings; a drawing a page defers moves to the next page. */
function drawingsKey(page: PageRecord): string {
  const drawings = page.anchoredDrawings;
  if (!drawings || drawings.length === 0) return '';
  return drawings
    .map((drawing) => `${drawing.anchorParagraphId}:${drawing.drawingNodeId}`)
    .join('|');
}

/** The most pages past a new reserve that its round tries; see `Tried`. */
const MAX_AHEAD_PAGES = 128;

/** The decided reserves of `record` from page `from`, moved to start at page `to`. */
function shiftedTail(record: ReserveWalkRecord, from: number, to: number): Map<number, number> {
  const moved = new Map<number, number>();
  for (const [index, height] of record.reserves) {
    if (index >= from) moved.set(index - from + to, height);
  }
  return moved;
}

/** The page at `at` and the page its answer reads: the next one, past a blank parity sheet. */
function pagesRead(pages: readonly PageRecord[], at: number): PageRecord[] {
  const next = pages[at + 1]?.parityBlank ? pages[at + 2] : pages[at + 1];
  return next ? [pages[at]!, next] : [pages[at]!];
}

function reservesEqual(a: Reserves, b: Reserves): boolean {
  if (a.size !== b.size) return false;
  for (const [index, height] of a) if (b.get(index) !== height) return false;
  return true;
}

/** Decide the footnote reserves page by page. */
export function* walkFootnoteReserves(options: ReserveWalkOptions): LayoutSteps<ReserveWalkResult> {
  const { start, previous } = options;
  let used = new Map([...start.reserves].filter(([index]) => index < start.floor));
  const starts = start.starts.slice(0, start.floor);
  const carries = start.carries.slice(0, start.floor);
  let floor = start.floor;
  let carry = start.carry;
  let exhausted = false;
  // The first page of the previous walk with this start signature, among those with unchanged
  // content after. A match is mostly a page or two from where unchanged content begins, so a
  // few lookups scan from there; a walk that looks up more builds the index once.
  let previousStarts: Map<string, number> | null = null;
  let scans = 0;
  const previousStartOf = (signature: string): number | undefined => {
    if (!previous?.record.complete) return undefined;
    const { record, unchangedFrom } = previous;
    if (previousStarts === null && scans < 4) {
      scans += 1;
      for (let index = Math.max(0, unchangedFrom); index < record.starts.length; index += 1) {
        if (record.starts[index] === signature) return index;
      }
      return undefined;
    }
    if (previousStarts === null) {
      previousStarts = new Map();
      for (let index = Math.max(0, unchangedFrom); index < record.starts.length; index += 1) {
        const start = record.starts[index];
        if (start && !previousStarts.has(start)) previousStarts.set(start, index);
      }
    }
    return previousStarts.get(signature);
  };
  // The page being decided, and its search so far.
  let page = -1;
  let phase: 'strict' | 'deferral' = 'strict';
  let strictValue: number | undefined;
  let decidedValue: number | undefined;
  const seen = new Map<number, number>();
  let rounds = 0;
  const enter = (index: number): void => {
    page = index;
    phase = 'strict';
    strictValue = undefined;
    decidedValue = undefined;
    seen.clear();
    rounds = 0;
  };
  let last: ReserveWalkRound | null = null;
  let lastUsed: Reserves | null = null;
  let complete = false;
  // Pages past the decided one that the next round lays out, and the page of the last new
  // reserve.
  let span = LOOKAHEAD_PAGES;
  let reservedAt = start.floor;

  // The pages the next round tries ahead; see `Tried`.
  let pending: Tried | null = null;
  const keepsBody = options.keepsBody ?? (() => true);

  for (;;) {
    if (options.stopped()) {
      // A newer edit waits: keep the last whole round as it was laid. Only the page being
      // decided changed since, so the decided pages keep their reserves.
      if (last?.whole && lastUsed) used = new Map(lastUsed);
      // The decided pages fix the notes carried into the next page, so the next pass can
      // start there.
      carries[floor] = carry;
      exhausted = true;
      break;
    }
    const tried = pending;
    pending = null;
    const round = yield* options.round(
      used,
      floor + span,
      floor + LOOKAHEAD_PAGES + (tried ? tried.last - floor : 0)
    );
    last = round;
    lastUsed = used;
    const pages = round.layout.pages;
    if (round.whole && floor >= pages.length) {
      complete = true;
      break;
    }
    // A page is decided only when the pages it reads are complete in this round.
    const roundReliable = round.whole
      ? pages.length
      : Math.max(0, pages.length - 1 - LOOKAHEAD_PAGES);
    if (page !== floor) enter(floor);
    // The layout the walk reads: this round, or while it checks the pages this round tried,
    // this round through `viewThrough` and the round the tries came from after it.
    let checking = tried;
    // Two pages start at the same place, with the same drawings carried in. The same carry on
    // both sides: only the body is compared.
    const sameStart = (a: PageRecord, b: PageRecord): boolean => {
      const signature = options.startOf(a, NO_CARRY);
      return (
        signature !== '' &&
        signature === options.startOf(b, NO_CARRY) &&
        drawingsKey(a) === drawingsKey(b)
      );
    };
    let view = pages;
    let viewLayout = round.layout;
    let viewThrough = -1;
    let reliable = roundReliable;
    // Positions through `agreed` start at the same place in this round and in `tried.base`.
    let agreed = floor;
    const enterView = (through: number): boolean => {
      if (!checking || through === viewThrough) return true;
      while (agreed < through + 1) {
        const a = pages[agreed + 1];
        const b = checking.base.pages[agreed + 1];
        if (!a || !b || a.index !== b.index) return false;
        if (!sameStart(a, b)) return false;
        agreed += 1;
      }
      view = pages.slice(0, through + 1).concat(checking.base.pages.slice(through + 1));
      viewLayout = { ...checking.base, pages: view };
      viewThrough = through;
      reliable = checking.reliable;
      return true;
    };
    // The reserves the view's pages were laid out with: none on the pages from the base. A
    // computation reads the reserves of the pages in its range only, so only those are copied;
    // a copy of every page's reserve for each page grew with the square of the page count.
    const viewUsed = (to: number): Reserves => {
      if (!checking || viewThrough < 0) return used;
      const near = new Map<number, number>();
      for (let position = floor; position < to && position <= viewThrough; position += 1) {
        const index = view[position]!.index;
        const height = used.get(index);
        if (height !== undefined) near.set(index, height);
      }
      return near;
    };
    let computedDeferral = phase === 'deferral';
    // The walk mostly decides a page or two before the previous walk applies, so each
    // computation covers a few pages from the page being decided, not the rest of the round.
    let computedTo = 0;
    let computedThrough = -2;
    let computed: ReserveComputeResult | null = null;
    const computeNear = (to: number): ReserveComputeResult => {
      computedTo = Math.min(view.length, to);
      computedThrough = viewThrough;
      return options.compute(viewLayout, viewUsed(computedTo), computedDeferral, {
        from: floor,
        carry,
        to: computedTo,
      });
    };
    // `relayout`: the page being decided takes another reserve and needs a new round.
    // `finished`: the rest of the previous walk applies.
    let relayout = false;
    let finished = false;
    for (;;) {
      if (checking && floor > checking.last) {
        // Every tried page took its tried reserve, so this round is the one the walk lays out
        // next without trying ahead.
        checking = null;
        view = pages;
        viewLayout = round.layout;
        viewThrough = -1;
        reliable = roundReliable;
      }
      const firstTry = checking !== null && checking.values.has(floor) && !checking.met.has(floor);
      if (checking && !enterView(firstTry ? floor - 1 : floor)) {
        // The page ends elsewhere with its reserve than with none, so the pages after it
        // move: lay out the round the walk lays out without trying ahead.
        used = kept(used, pages[floor]!.index);
        relayout = true;
        break;
      }
      if (floor >= reliable) break;
      const at = view[floor]!;
      if (
        computed === null ||
        computedThrough !== viewThrough ||
        computedDeferral !== (phase === 'deferral') ||
        (computedTo < view.length && floor + COMPUTE_READS > computedTo)
      ) {
        computedDeferral = phase === 'deferral';
        computed = computeNear(floor + COMPUTE_SPAN);
      }
      // A tried page is read first as the walk reads every page first: with no reserve.
      const have = firstTry ? 0 : (used.get(at.index) ?? 0);
      const need = computed.reserves.get(at.index) ?? 0;
      if (decidedValue === undefined && need !== have) {
        seen.set(have, need);
        rounds += 1;
        let tryAfter = false;
        if (seen.has(need) || rounds >= MAX_PAGE_RESERVE_ROUNDS) {
          decidedValue = cycleAnswer(seen, phase === 'deferral' ? strictValue : undefined);
          exhausted = true;
          if (decidedValue === have) continue;
          used = withReserve(used, at.index, decidedValue);
        } else if (firstTry && need === checking!.values.get(floor)) {
          // The page needs the reserve this round tried, so this round is its next round.
          checking!.met.add(floor);
          continue;
        } else {
          used = withReserve(used, at.index, need);
          tryAfter =
            have === 0 && rounds === 1 && options.tryAhead !== false && keepsBody(at, need);
        }
        // Reserves tried past this page do not hold: its new reserve moves what follows.
        if (checking) used = kept(used, at.index);
        if (tryAfter) {
          // The page's first need: the next round also tries the needs that one computation
          // gives the pages after it. The computation at hand covers a few pages; a further one
          // runs only when none of those moves its body.
          const far = Math.min(reliable, floor + MAX_AHEAD_PAGES + 1);
          const near = Math.min(far, computedTo - COMPUTE_READS);
          pending = tryAhead(computed, view, floor, near, viewLayout, reliable, keepsBody);
          if (near < far && (pending === null || !pending.moves)) {
            const guess = computeNear(far + COMPUTE_READS);
            pending = tryAhead(guess, view, floor, far, viewLayout, reliable, keepsBody);
          }
          if (pending) {
            // One copy for every tried page: a copy per page grew with the reserves held.
            const next = new Map(used);
            for (const [position, height] of pending.values)
              next.set(view[position]!.index, height);
            used = next;
          }
        }
        relayout = true;
        break;
      }
      if (
        decidedValue === undefined &&
        phase === 'strict' &&
        pagesRead(view, floor).some((read) => computed!.orphanPages.has(read.index))
      ) {
        // The page settles strictly first. A second-line reference on it, or on a page it
        // reads, may then stay with its opening line while its note continues; a page that
        // finds no such answer keeps the strict one.
        phase = 'deferral';
        strictValue = have;
        seen.clear();
        rounds = 0;
        continue;
      }
      // A page this round tried a reserve on that settles with none: lay out its round.
      const settledUntried = firstTry;
      if (settledUntried) used = kept(withReserve(used, at.index, have), at.index);
      starts[at.index] = options.startOf(at, carry);
      carries[at.index] = carry;
      carry = computed.carryBefore[floor + 1] ?? new Map();
      floor += 1;
      enter(floor);
      if (settledUntried) {
        relayout = true;
        break;
      }
      // The rest of the previous walk applies once a page starts where one of its pages did.
      const next = view[floor];
      // An empty signature names no one place (see `startOf`), so it never matches.
      const signature = next && previous && floor < reliable ? options.startOf(next, carry) : '';
      const found = signature ? previousStartOf(signature) : undefined;
      const from =
        found !== undefined && (!options.parityStarts || (next!.index - found) % 2 === 0)
          ? found
          : undefined;
      if (next && previous && from !== undefined) {
        const decidedUsed = checking ? kept(used, next.index - 1) : used;
        used = new Map([...decidedUsed, ...shiftedTail(previous.record, from, next.index)]);
        for (let index = from; index < previous.record.starts.length; index += 1) {
          const target = index - from + next.index;
          starts[target] = previous.record.starts[index]!;
          carries[target] = previous.record.carries[index];
        }
        complete = true;
        finished = true;
        break;
      }
    }
    if (finished) break;
    const triedTo = pending ? pending.last - floor : 0;
    if (relayout) reservedAt = floor;
    if (relayout && !options.growAfterReserve) {
      span = LOOKAHEAD_PAGES + triedTo;
      continue;
    }
    span = Math.max(
      Math.min(Math.max(MAX_ROUND_PAGES, floor - reservedAt), span * 2),
      LOOKAHEAD_PAGES + triedTo
    );
    if (relayout) continue;
    if (round.whole && floor >= pages.length) {
      complete = true;
      break;
    }
  }

  return {
    reserves: used,
    record: {
      reserves: used,
      decided: complete ? starts.length : floor,
      complete,
      starts,
      carries,
    },
    exhausted,
    last,
    lastCurrent: lastUsed !== null && reservesEqual(lastUsed, used),
  };
}
