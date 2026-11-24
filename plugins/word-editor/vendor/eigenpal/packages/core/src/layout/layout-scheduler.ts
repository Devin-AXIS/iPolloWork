// Stale-safe layout scheduling driven by authoritative model changes (task 9.1).
//
// The store already says exactly what a commit touched — dirty, created and deleted node
// ids, split/join pairs, dependency keys, and an impact class. Layout does not have to
// guess, and it must not: guessing is how a caret ends up drawn against geometry from a
// revision the model has already left behind.
//
// Two properties this owns, and nothing else in the pipeline can:
//
//   SCOPE. The impact class of a commit decides how much of the flow can be affected.
//   A text edit inside one paragraph cannot move a paragraph above it; a split can move
//   everything below it; a page-geometry change moves everything. Scope is accumulated
//   across coalesced changes by WIDENING, never narrowing — two text-local edits in
//   different paragraphs stay text-local over the union of their ids, but one structural
//   edit anywhere makes the batch structural.
//
//   STALENESS. Layout of revision R may only be published while the model is still at R.
//   A result computed against a superseded revision is discarded, not published late and
//   not merged: publishing it would show the user a document that no longer exists. This
//   holds however the work was scheduled, so an async host cannot introduce the race by
//   choosing a slower frame callback.
//
// This schedules and publishes only. Reusing the previous layout for the untouched suffix
// is task 9.3, and the caches it consults are 9.2; both sit behind `run`, which is handed a
// scope this module computed and is free to ignore it and lay out everything.

import type { ImpactClass } from '../store/store/tree-op-types.ts';
import type { TreeModelChange } from '../store/store/tree-store.ts';
import type { SemanticLayout } from './semantic-records.ts';

/**
 * What a batch of commits can affect.
 *
 * `paragraphIds` is the set the commits touched directly. What that set MEANS depends on
 * `impact`: for a local impact it bounds the work, for a structural one it only says where
 * the reflow starts.
 */
export interface LayoutScope {
  readonly impact: ImpactClass;
  /** Node ids touched directly by the coalesced commits. */
  readonly paragraphIds: ReadonlySet<string>;
  /** Ids the commits created — no previous layout exists for these. */
  readonly created: ReadonlySet<string>;
  /** Ids the commits removed — any retained layout for these must be released. */
  readonly deleted: ReadonlySet<string>;
  /** Cache keys the commits invalidated (styles, numbering, fonts). */
  readonly dependencyKeys: ReadonlySet<string>;
  /** True when the block SEQUENCE changed, so ids alone cannot bound the reflow. */
  readonly structural: boolean;
  /** The revision this scope describes — the layout result must carry the same one. */
  readonly revision: number;
}

/** Widening order. A batch takes the widest impact any of its commits had. */
const IMPACT_ORDER: readonly ImpactClass[] = [
  'text-local',
  'paragraph-local',
  'flow-structural',
  'global',
];

function widen(a: ImpactClass, b: ImpactClass): ImpactClass {
  return IMPACT_ORDER.indexOf(b) > IMPACT_ORDER.indexOf(a) ? b : a;
}

/** How the scheduler produces layouts and when it publishes them. */
export interface LayoutSchedulerOptions {
  /**
   * Produce a complete layout for the CURRENT model state.
   *
   * Given the accumulated scope so an incremental implementation can use it. It must tag
   * the result with the revision it actually read, which is what makes staleness detectable
   * rather than assumed.
   */
  readonly run: (scope: LayoutScope) => SemanticLayout;
  /** The model's revision right now. Read at publish time, never cached. */
  readonly currentRevision: () => number;
  /** Called with a layout that is known current. Never called with a stale one. */
  readonly publish: (layout: SemanticLayout, scope: LayoutScope) => void;
  /**
   * Defer work to a later turn, returning a canceller.
   *
   * Injected rather than assumed: the browser wants an animation frame, tests want to step
   * the queue by hand, and a server has neither.
   */
  readonly schedule?: (run: () => void) => () => void;
  /**
   * Run a layout in slices instead of in one call (task 9.5).
   *
   * Optional: without it `run` is used and completes in one turn, which is right for a
   * document small enough that slicing costs more than it saves.
   */
  readonly runCooperatively?: (scope: LayoutScope) => CooperativeRun;
}

export interface CooperativeRun {
  /**
   * Advance the work. Returns the finished layout, or null to be called again.
   *
   * Split so a global relayout does not hold the main thread for the whole document: the
   * scheduler yields between slices and a newer revision can cancel the run mid-flight
   * rather than the user waiting for work whose result is already stale.
   */
  step(): SemanticLayout | null;
  /** Abandon the run. Nothing partial is ever published. */
  cancel(): void;
}

/**
 * Coalesces commits into layout passes.
 *
 * A keystroke is one commit but must not be one full layout pass, so changes accumulate into a
 * scope and are laid out together. Every published layout is tagged with the revision it actually
 * read, which is what makes a stale result detectable rather than merely late.
 */
export interface LayoutScheduler {
  /** Record a commit. Coalesces with anything already pending. */
  notify(change: TreeModelChange): void;
  /** Request a relayout for a reason the store did not report (page size, zoom, fonts). */
  invalidateAll(revision: number, reason?: string): void;
  /** Run any pending work now, synchronously. Returns whether a layout was published. */
  flush(): boolean;
  /** The scope that would be used if `flush` ran now, or null when nothing is pending. */
  pending(): LayoutScope | null;
  /** Drop pending work without publishing — for teardown. */
  cancel(): void;
  /** How many layouts were discarded for being stale. Diagnostics, and a test hook. */
  readonly staleDiscards: number;
  /** How many cooperative runs were abandoned because a newer revision arrived. */
  readonly cancelledRuns: number;
}

/** An empty accumulator: the narrowest scope, which every commit then widens. */
function emptyScope(revision: number): {
  impact: ImpactClass;
  paragraphIds: Set<string>;
  created: Set<string>;
  deleted: Set<string>;
  dependencyKeys: Set<string>;
  structural: boolean;
  revision: number;
} {
  return {
    impact: 'text-local',
    paragraphIds: new Set(),
    created: new Set(),
    deleted: new Set(),
    dependencyKeys: new Set(),
    structural: false,
    revision,
  };
}

/**
 * Build the scheduler that turns a stream of commits into coalesced layout passes.
 *
 * Keystrokes arrive faster than a document can be laid out, so changes accumulate into one scope
 * and are laid out together rather than once per commit.
 */
export function createLayoutScheduler(options: LayoutSchedulerOptions): LayoutScheduler {
  const { run, currentRevision, publish, schedule } = options;
  let accumulator: ReturnType<typeof emptyScope> | null = null;
  let cancelScheduled: (() => void) | null = null;
  let inFlight: CooperativeRun | null = null;
  let staleDiscards = 0;
  let cancelledRuns = 0;

  /**
   * Drive a run to completion, cooperatively when the host supplies a slicer.
   *
   * `flush` is synchronous by contract — a caller that asks for a layout now gets one — so
   * the slices are driven here rather than across turns. What slicing buys even so is a
   * cancellation point: a commit landing mid-run abandons it on the next slice instead of
   * paying for a layout of a revision nobody will see.
   */
  function runToCompletion(scope: LayoutScope): SemanticLayout | null {
    const slicer = options.runCooperatively;
    if (!slicer) return run(scope);
    const cooperative = slicer(scope);
    inFlight = cooperative;
    try {
      for (;;) {
        const result = cooperative.step();
        if (result) return result;
        // BETWEEN SLICES is the only place cancellation can happen. Without this the loop
        // ran to completion and the finished layout was thrown away as stale — slicing
        // bought nothing, because nobody ever asked whether the work was still wanted.
        if (currentRevision() !== scope.revision) {
          cooperative.cancel();
          cancelledRuns += 1;
          return null;
        }
        // Cancelled from underneath, by a re-entrant flush or a teardown. Stepping a
        // cancelled run again would never terminate.
        if (inFlight !== cooperative) return null;
      }
    } finally {
      if (inFlight === cooperative) inFlight = null;
    }
  }

  /** Fold an abandoned scope back into the pending batch, so nothing it covered is lost. */
  function carryForward(scope: LayoutScope): void {
    const next = ensure(currentRevision());
    next.impact = widen(next.impact, scope.impact);
    next.structural = next.structural || scope.structural;
    for (const id of scope.paragraphIds) next.paragraphIds.add(id);
    for (const id of scope.created) next.created.add(id);
    for (const id of scope.deleted) next.deleted.add(id);
    for (const key of scope.dependencyKeys) next.dependencyKeys.add(key);
  }

  const freeze = (state: ReturnType<typeof emptyScope>): LayoutScope => ({
    impact: state.impact,
    paragraphIds: state.paragraphIds,
    created: state.created,
    deleted: state.deleted,
    dependencyKeys: state.dependencyKeys,
    structural: state.structural,
    revision: state.revision,
  });

  function ensure(revision: number): ReturnType<typeof emptyScope> {
    if (!accumulator) accumulator = emptyScope(revision);
    // The batch always describes the LATEST revision it has seen; an older one cannot
    // narrow it, because the work will read the model as it is when it finally runs.
    accumulator.revision = Math.max(accumulator.revision, revision);
    return accumulator;
  }

  function arm(): void {
    if (!schedule || cancelScheduled) return;
    cancelScheduled = schedule(() => {
      cancelScheduled = null;
      flush();
    });
  }

  function flush(): boolean {
    if (cancelScheduled) {
      cancelScheduled();
      cancelScheduled = null;
    }
    // A slice in flight is abandoned, not awaited: its result describes a revision that has
    // already been superseded, and finishing it would only delay the one that has not.
    if (inFlight) {
      inFlight.cancel();
      inFlight = null;
      cancelledRuns += 1;
    }
    const state = accumulator;
    if (!state) return false;
    accumulator = null;
    const scope = freeze(state);
    const layout = runToCompletion(scope);
    if (!layout) {
      // Abandoned mid-flight. The scope is carried into a retry rather than dropped, so the
      // newer revision still gets laid out.
      staleDiscards += 1;
      carryForward(scope);
      arm();
      return false;
    }
    // Checked AFTER the work, against the model as it is NOW: a commit landing while layout
    // ran is exactly the case this exists for. Re-arm rather than publish, so the newer
    // revision gets its own pass instead of inheriting a result computed before it.
    if (layout.revision !== currentRevision()) {
      staleDiscards += 1;
      carryForward(scope);
      arm();
      return false;
    }
    publish(layout, scope);
    return true;
  }

  return {
    notify(change) {
      // `currentRevision()`, NOT `change.toRevision`: the two count in different spaces.
      // A change published for a header/footer or notes part carries THAT part's own
      // revision, which starts at zero when the part is created and therefore trails the
      // package revision this scheduler validates against. A scope tagged with the smaller
      // number is discarded by `flush` as stale on the pass that would have published it,
      // so the surface painted one revision behind and mirrored a post-edit caret into
      // pre-edit nodes. `notify` runs synchronously from the publish inside the commit, so
      // the package revision here is exactly the one the change produced.
      const state = ensure(currentRevision());
      state.impact = widen(state.impact, change.impact);
      for (const id of change.dirty) state.paragraphIds.add(id);
      for (const id of change.created) {
        state.created.add(id);
        state.paragraphIds.add(id);
      }
      for (const id of change.deleted) {
        state.deleted.add(id);
        state.paragraphIds.add(id);
      }
      for (const key of change.dependencyKeys) state.dependencyKeys.add(key);
      // A split or join changes the block SEQUENCE, so every following paragraph can move
      // even though none of them is dirty. Both endpoints join the touched set so a
      // consumer can find where the reflow starts.
      for (const entry of change.splitJoin) {
        state.structural = true;
        if ('split' in entry) {
          state.paragraphIds.add(entry.split.from);
          state.paragraphIds.add(entry.split.tail);
        } else {
          state.paragraphIds.add(entry.join.kept);
          state.paragraphIds.add(entry.join.removed);
        }
      }
      if (change.impact === 'flow-structural' || change.impact === 'global') {
        state.structural = true;
      }
      arm();
    },

    invalidateAll(revision, reason) {
      const state = ensure(revision);
      // Full invalidation remains flow-structural: `global` is reserved for shared story
      // parts (header/footer) whose edit reaches every attached page.
      state.impact = 'flow-structural';
      state.structural = true;
      // Not a node-level invalidation: no id is dirty, the whole flow is. An empty id set
      // with a structural impact is how a consumer tells "everything" from "this list".
      if (reason) state.dependencyKeys.add(reason);
      arm();
    },

    flush,
    pending: () => (accumulator ? freeze(accumulator) : null),

    cancel() {
      cancelScheduled?.();
      cancelScheduled = null;
      inFlight?.cancel();
      inFlight = null;
      accumulator = null;
    },

    get staleDiscards() {
      return staleDiscards;
    },

    get cancelledRuns() {
      return cancelledRuns;
    },
  };
}
