// The footnote reserve walk decides the same reserves with tries ahead as without them.
//
// A small page model drives the walk: blocks of whole lines on pages of twenty lines, page
// breaks after some blocks, and notes cited from a block's first line. A page's reserve takes
// lines from its body, so it can push a citation to the next page. The walk with tries must
// give every page the reserve, start and carry the walk without tries gives it, and lay out
// fewer rounds where reserves leave the next page where it started.

import { describe, expect, test } from 'bun:test';
import { drainLayoutSteps, type LayoutSteps } from '../layout-steps.ts';
import {
  walkFootnoteReserves,
  type ReserveComputeRange,
  type ReserveComputeResult,
  type ReserveWalkResult,
  type ReserveWalkRound,
} from '../note-reserve-walk.ts';
import type { PageRecord, SemanticLayout } from '../semantic-records.ts';

const CAPACITY = 20;
/** The least body a reserve leaves on a page, in lines. */
const MIN_BODY = 2;

interface Block {
  readonly lines: number;
  /** Note sizes in lines, cited from the block's first line. */
  readonly notes: readonly number[];
  readonly breakAfter: boolean;
}

function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

function blocksFor(seed: number): Block[] {
  const next = random(seed);
  const count = 20 + Math.floor(next() * 180);
  const breakRate = [0, 0.1, 0.3, 0.8][Math.floor(next() * 4)]!;
  const noteRate = [0.1, 0.3, 0.6][Math.floor(next() * 3)]!;
  const longRate = [0, 0.1, 0.3][Math.floor(next() * 3)]!;
  return Array.from({ length: count }, () => ({
    lines: 1 + Math.floor(next() * 8),
    notes:
      next() < noteRate
        ? [next() < longRate ? 10 + Math.floor(next() * 20) : 1 + Math.floor(next() * 6)]
        : [],
    breakAfter: next() < breakRate,
  }));
}

interface Fragment {
  readonly block: number;
  readonly start: number;
  readonly lines: number;
}

/** The body laid out with `reserves`, in lines; a fake page record per page. */
function paginate(blocks: readonly Block[], reserves: ReadonlyMap<number, number>): PageRecord[] {
  const pages: Fragment[][] = [[]];
  let used = 0;
  const capacity = () =>
    Math.max(MIN_BODY, CAPACITY - Math.min(reserves.get(pages.length - 1) ?? 0, CAPACITY));
  blocks.forEach((block, index) => {
    let offset = 0;
    while (offset < block.lines) {
      if (used >= capacity()) {
        pages.push([]);
        used = 0;
      }
      const take = Math.min(block.lines - offset, capacity() - used);
      pages[pages.length - 1]!.push({ block: index, start: offset, lines: take });
      used += take;
      offset += take;
    }
    if (block.breakAfter && index < blocks.length - 1) {
      pages.push([]);
      used = 0;
    }
  });
  return pages.map(
    (fragments, index) =>
      ({
        index,
        fragments: fragments.map((fragment) => ({
          kind: 'paragraph',
          paragraphId: `b${fragment.block}`,
          range: { start: fragment.start },
          lines: fragment.lines,
        })),
        contentBox: { x: 0, y: 0, width: 100, height: CAPACITY },
      }) as unknown as PageRecord
  );
}

/**
 * Each page's need: the notes cited on it and the lines carried in, up to the area limit. A
 * page laid out with an odd reserve needs a line more and carries a line more, and one laid out
 * with an even reserve carries a line less, as the real computation also reads the reserve a
 * page was laid out with.
 */
function compute(
  blocks: readonly Block[],
  layout: SemanticLayout,
  used: ReadonlyMap<number, number>,
  range: ReserveComputeRange
): ReserveComputeResult {
  const reserves = new Map<number, number>();
  const carryBefore: number[] = [];
  let carry = range.carry as number;
  const end = Math.min(layout.pages.length, range.to ?? layout.pages.length);
  carryBefore[range.from] = carry;
  for (let at = range.from; at < end; at += 1) {
    const page = layout.pages[at]!;
    let need = carry;
    for (const fragment of page.fragments) {
      const record = fragment as unknown as { paragraphId: string; range: { start: number } };
      if (record.range.start !== 0) continue;
      for (const lines of blocks[Number(record.paragraphId.slice(1))]!.notes) need += lines;
    }
    if (need > 0 && (used.get(page.index) ?? 0) % 2 === 1) need += 1;
    const reserve = Math.min(need, CAPACITY - MIN_BODY);
    if (reserve > 0) reserves.set(page.index, reserve);
    carry = need - reserve;
    // A page laid out with an odd reserve carries a line more, with an even one a line less.
    const laid = used.get(page.index) ?? 0;
    if (laid > 0) carry = Math.max(0, carry + (laid % 2 === 1 ? 1 : -1));
    carryBefore[at + 1] = carry;
  }
  return {
    reserves,
    stable: true,
    reasons: [],
    orphanCandidates: false,
    orphanPages: new Set(),
    carryBefore,
  };
}

/** Tries: none, on every page, or past pages whose lines and reserve fit. */
type Tries = 'none' | 'always' | 'fit';

function walk(blocks: readonly Block[], tries: Tries): ReserveWalkResult & { rounds: number } {
  let rounds = 0;
  function* round(reserves: ReadonlyMap<number, number>): LayoutSteps<ReserveWalkRound> {
    rounds += 1;
    return { layout: { revision: 0, pages: paginate(blocks, reserves) }, whole: true };
  }
  const result = drainLayoutSteps(
    walkFootnoteReserves({
      start: { reserves: new Map(), floor: 0, carry: 0, starts: [], carries: [] },
      round,
      compute: (layout, used, _deferral, range) => compute(blocks, layout, used, range),
      startOf: (page, carry) => {
        const first = page.fragments[0] as unknown as
          { paragraphId: string; range: { start: number } } | undefined;
        return first ? `${first.paragraphId}:${first.range.start}|${String(carry)}` : '';
      },
      stopped: () => false,
      tryAhead: tries !== 'none',
      ...(tries === 'fit'
        ? {
            keepsBody: (page: PageRecord, reserve: number) =>
              page.fragments.reduce(
                (sum, fragment) => sum + (fragment as unknown as { lines: number }).lines,
                0
              ) +
                reserve <=
              CAPACITY,
          }
        : {}),
    })
  );
  return { ...result, rounds };
}

const entries = (reserves: ReadonlyMap<number, number>) =>
  [...reserves].sort((a, b) => a[0] - b[0]);

describe('the footnote reserve walk with tries ahead', () => {
  test('decides what the walk without tries decides', () => {
    let fit = 0;
    let untried = 0;
    for (let seed = 1; seed <= 5000; seed += 1) {
      const blocks = blocksFor(seed);
      const a = walk(blocks, 'none');
      // Trying past every page reaches the most ways a try can fail.
      for (const tries of ['always', 'fit'] as const) {
        const b = walk(blocks, tries);
        expect(entries(b.reserves)).toEqual(entries(a.reserves));
        expect(b.record.starts).toEqual(a.record.starts);
        expect(b.record.carries).toEqual(a.record.carries);
        expect(b.record.decided).toBe(a.record.decided);
        expect(b.exhausted).toBe(a.exhausted);
        if (tries === 'fit') fit += b.rounds;
      }
      untried += a.rounds;
    }
    expect(fit).toBeLessThan(untried);
  });

  test('lays out a few rounds for many pages that each end at a page break', () => {
    const blocks = Array.from({ length: 300 }, () => ({
      lines: 6,
      notes: [2],
      breakAfter: true,
    }));
    const a = walk(blocks, 'none');
    const b = walk(blocks, 'fit');
    expect(entries(b.reserves)).toEqual(entries(a.reserves));
    expect(a.rounds).toBeGreaterThan(250);
    expect(b.rounds).toBeLessThan(40);
  });
});
