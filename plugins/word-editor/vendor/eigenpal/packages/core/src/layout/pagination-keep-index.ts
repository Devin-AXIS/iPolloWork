/** Cached range summaries for paragraph keep chains. No summary crosses a chain boundary. */
export interface KeepRange {
  readonly before: number;
  readonly after: number;
  readonly advance: number;
  readonly maxWhole: number;
  readonly maxSplit: number;
  readonly last: number;
}

/** A lazy tree visits each measured member once, then skips complete ranges in logarithmic time. */
export function createKeepRangeIndex(
  count: number,
  leaf: (index: number) => KeepRange | null,
  sumSpacing: boolean
) {
  const ranges = new Map<number, KeepRange | null>();
  function join(a: KeepRange | null, b: KeepRange | null): KeepRange | null {
    if (!a || !b) return null;
    if (a.last < 0) return b;
    if (b.last < 0) return a;
    const offset = a.advance + (sumSpacing ? b.before : Math.max(b.before, a.after) - a.after);
    return {
      before: a.before,
      after: b.after,
      advance: offset + b.advance,
      maxWhole: Math.max(a.maxWhole, offset + b.maxWhole),
      maxSplit: Math.max(a.maxSplit, offset + b.maxSplit),
      last: b.last,
    };
  }
  return {
    walk(
      from: number,
      through: number,
      consume: (range: KeepRange) => boolean | 'stop',
      visit: (index: number) => boolean
    ) {
      function walk(node: number, lo: number, hi: number): boolean {
        if (hi <= from || lo > through) return true;
        if (lo >= from && hi - 1 <= through) {
          const summary = ranges.get(node);
          if (summary) {
            const consumed = consume(summary);
            if (consumed === 'stop') return false;
            if (consumed) return true;
          }
        }
        if (hi - lo === 1) {
          const more = visit(lo);
          if (!ranges.has(node)) ranges.set(node, leaf(lo));
          return more;
        }
        const mid = lo + Math.floor((hi - lo) / 2);
        const more = walk(node * 2, lo, mid) && walk(node * 2 + 1, mid, hi);
        if (ranges.has(node * 2) && ranges.has(node * 2 + 1)) {
          ranges.set(node, join(ranges.get(node * 2)!, ranges.get(node * 2 + 1)!));
        }
        return more;
      }
      if (count > 0) walk(1, 0, count);
    },
  };
}
