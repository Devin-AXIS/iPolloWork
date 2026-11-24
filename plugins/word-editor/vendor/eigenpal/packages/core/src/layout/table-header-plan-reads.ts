// Serving a header plan's repeated option reads again while the plan stays unchanged.
//
// A width update reads `optionsAt(index, top)` from one header plan on every page the group
// repeats on. A read derives the row's options from the plan's decisions and its measurement
// memos, then settles a detached head with a measuring probe; only that settle can change the
// plan (`withdrawAt`). The memos are pure in their keys, and with a fixed table edge, fixed
// deps and no wrap zones the probe is deterministic. So a read that changed nothing, repeated
// for the same row and top before anything changes the plan, returns the same options, changes
// nothing, and reports exactly the break keys its settle probes reported: the memos it needs
// are already filled, so no other probe runs.
//
// A read is served again only under those conditions; its probe keys are replayed in order,
// each read once from the break cache, as the probe reports and reads them. Any read during
// which the plan changed is never kept, and every change to the plan invalidates every kept
// read.

import type { TableFlowDeps } from './semantic-table-layout.ts';
import type { RowVMergeLayoutOptions } from './table-vmerge-heights.ts';

interface Read {
  readonly top: number;
  /** The plan's change count when the read ran; it did not change during the read. */
  readonly changes: number;
  readonly options: RowVMergeLayoutOptions | undefined;
  /** Break keys the read's settle probes reported, in order. */
  readonly keys: readonly string[];
}

/** Repeated reads of one plan. */
export interface RepeatedPlanReads {
  /**
   * The options `compute` would return now. `changes` counts every change to the plan.
   * `compute` receives the list its settle probes report break keys into, or `undefined`
   * when reads are not kept.
   */
  read(
    index: number,
    top: number,
    changes: () => number,
    compute: (heard: string[] | undefined) => RowVMergeLayoutOptions | undefined
  ): RowVMergeLayoutOptions | undefined;
}

let observer: { served: number; computed: number; disabled: boolean } | null = null;

/**
 * @internal Counts plan reads served again and computed, for tests that must see the reuse.
 * `disabled` computes every read the way a plan without kept reads does.
 */
export function repeatedPlanReadsTestRecorder(disabled = false): {
  readonly served: number;
  readonly computed: number;
  dispose(): void;
} {
  const counts = { served: 0, computed: 0, disabled };
  observer = counts;
  return {
    get served() {
      return counts.served;
    },
    get computed() {
      return counts.computed;
    },
    dispose() {
      if (observer === counts) observer = null;
    },
  };
}

/** Kept reads for one plan; `sink` is the deps its probes report and read keys through. */
export function createRepeatedPlanReads(
  sink: Pick<TableFlowDeps, 'onCellBreakKey' | 'cache'>
): RepeatedPlanReads {
  const reads = new Map<number, Read>();
  return {
    read(index, top, changes, compute) {
      if (observer?.disabled) {
        observer.computed += 1;
        return compute(undefined);
      }
      const before = changes();
      const known = reads.get(index);
      if (known && Object.is(known.top, top) && known.changes === before) {
        for (const key of known.keys) {
          sink.onCellBreakKey?.(key);
          sink.cache?.get(key);
        }
        if (observer) observer.served += 1;
        return known.options;
      }
      const heard: string[] = [];
      const options = compute(heard);
      if (observer) observer.computed += 1;
      if (changes() === before) reads.set(index, { top, changes: before, options, keys: heard });
      else reads.delete(index);
      return options;
    },
  };
}
