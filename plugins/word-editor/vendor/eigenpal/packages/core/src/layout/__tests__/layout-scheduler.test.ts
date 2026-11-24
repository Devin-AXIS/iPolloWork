// Stale-safe layout scheduling driven by authoritative model changes (task 9.1).

import { describe, expect, test } from 'bun:test';
import type { TreeModelChange } from '@docx-editor.dev/core/store';
import { createLayoutScheduler, type LayoutScope } from '../layout-scheduler.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const layoutAt = (revision: number): SemanticLayout =>
  ({ revision, pages: [] }) as unknown as SemanticLayout;

const change = (partial: Partial<TreeModelChange> = {}): TreeModelChange => ({
  change: 'model-change',
  fromRevision: 0,
  toRevision: 1,
  commitId: 'c1',
  origin: 'human',
  dirty: [],
  created: [],
  deleted: [],
  splitJoin: [],
  dependencyKeys: [],
  impact: 'text-local',
  ...partial,
});

/** A scheduler whose revision the test controls, so the race can be produced on demand. */
function harness(options: { revisionDuringRun?: (scope: LayoutScope) => number } = {}) {
  let revision = 1;
  const published: { layout: SemanticLayout; scope: LayoutScope }[] = [];
  const runs: LayoutScope[] = [];
  const queue: (() => void)[] = [];
  const scheduler = createLayoutScheduler({
    run: (scope) => {
      runs.push(scope);
      // Simulates a commit landing WHILE layout runs: the work read `scope.revision`, and
      // the model has moved on by the time it finishes.
      const during = options.revisionDuringRun?.(scope);
      if (during !== undefined) revision = during;
      return layoutAt(scope.revision);
    },
    currentRevision: () => revision,
    publish: (layout, scope) => published.push({ layout, scope }),
    schedule: (fn) => {
      queue.push(fn);
      return () => {
        const index = queue.indexOf(fn);
        if (index >= 0) queue.splice(index, 1);
      };
    },
  });
  return {
    scheduler,
    published,
    runs,
    step: () => queue.splice(0).forEach((fn) => fn()),
    queueLength: () => queue.length,
    setRevision: (next: number) => (revision = next),
  };
}

describe('scope accumulates from the store, and only widens (task 9.1)', () => {
  test('a text edit scopes to the paragraph it touched', () => {
    const h = harness();
    h.scheduler.notify(change({ dirty: ['p1'], impact: 'text-local' }));
    const scope = h.scheduler.pending()!;
    expect(scope.impact).toBe('text-local');
    expect([...scope.paragraphIds]).toEqual(['p1']);
    expect(scope.structural).toBe(false);
  });

  test('two local edits in different paragraphs stay local over the union', () => {
    const h = harness();
    h.scheduler.notify(change({ dirty: ['p1'] }));
    // The store bumps its revision before it publishes, so a second commit is a second
    // revision by the time the subscriber runs.
    h.setRevision(2);
    h.scheduler.notify(change({ dirty: ['p2'], toRevision: 2 }));
    const scope = h.scheduler.pending()!;
    expect(scope.impact).toBe('text-local');
    expect([...scope.paragraphIds].sort()).toEqual(['p1', 'p2']);
    expect(scope.revision).toBe(2);
  });

  test('one structural commit makes the whole batch structural', () => {
    const h = harness();
    h.scheduler.notify(change({ dirty: ['p1'], impact: 'text-local' }));
    h.scheduler.notify(change({ dirty: ['p2'], impact: 'flow-structural', toRevision: 2 }));
    h.scheduler.notify(change({ dirty: ['p3'], impact: 'text-local', toRevision: 3 }));
    const scope = h.scheduler.pending()!;
    // Narrowing back to text-local would leave the paragraphs BELOW the split at stale
    // positions, which is the defect the widening rule exists to prevent.
    expect(scope.impact).toBe('flow-structural');
    expect(scope.structural).toBe(true);
  });

  test('a global header/footer story edit widens past flow-structural', () => {
    const h = harness();
    h.scheduler.notify(change({ dirty: ['p1'], impact: 'text-local' }));
    h.scheduler.notify(change({ dirty: ['hf1'], impact: 'global', toRevision: 2 }));
    const scope = h.scheduler.pending()!;
    expect(scope.impact).toBe('global');
    expect(scope.structural).toBe(true);
  });

  test('a story revision that trails the package revision still scopes to the package', () => {
    const h = harness();
    // A header/footer part counts its own revisions from zero, so its change reports a
    // number well below the package revision the scheduler validates against. Taking the
    // scope revision from the change discarded the pass as stale and painted the previous
    // revision — which put the caret back where the edit started.
    h.setRevision(7);
    h.scheduler.notify(
      change({ dirty: ['hf1'], impact: 'global', fromRevision: 0, toRevision: 1 })
    );
    expect(h.scheduler.pending()!.revision).toBe(7);
    expect(h.scheduler.flush()).toBe(true);
    expect(h.published.length).toBe(1);
    expect(h.published[0]!.layout.revision).toBe(7);
    expect(h.scheduler.staleDiscards).toBe(0);
  });

  test('a split marks the batch structural and names both endpoints', () => {
    const h = harness();
    h.scheduler.notify(
      change({ splitJoin: [{ split: { from: 'p1', tail: 'p1b' } }], impact: 'paragraph-local' })
    );
    const scope = h.scheduler.pending()!;
    expect(scope.structural).toBe(true);
    expect([...scope.paragraphIds].sort()).toEqual(['p1', 'p1b']);
  });

  test('a join marks the batch structural and names both endpoints', () => {
    const h = harness();
    h.scheduler.notify(change({ splitJoin: [{ join: { kept: 'p1', removed: 'p2' } }] }));
    const scope = h.scheduler.pending()!;
    expect(scope.structural).toBe(true);
    expect([...scope.paragraphIds].sort()).toEqual(['p1', 'p2']);
  });

  test('created and deleted ids are carried separately as well as in the touched set', () => {
    const h = harness();
    h.scheduler.notify(change({ created: ['new1'], deleted: ['old1'] }));
    const scope = h.scheduler.pending()!;
    expect([...scope.created]).toEqual(['new1']);
    expect([...scope.deleted]).toEqual(['old1']);
    // Both are also touched: one has no previous layout, the other's must be released.
    expect([...scope.paragraphIds].sort()).toEqual(['new1', 'old1']);
  });

  test('dependency keys accumulate across coalesced commits', () => {
    const h = harness();
    h.scheduler.notify(change({ dependencyKeys: ['style:Heading1'] }));
    h.scheduler.notify(change({ dependencyKeys: ['numbering:1'], toRevision: 2 }));
    expect([...h.scheduler.pending()!.dependencyKeys].sort()).toEqual([
      'numbering:1',
      'style:Heading1',
    ]);
  });

  test('invalidateAll is structural with no ids, which is how "everything" is expressed', () => {
    const h = harness();
    h.scheduler.invalidateAll(4, 'page-geometry');
    const scope = h.scheduler.pending()!;
    expect(scope.impact).toBe('flow-structural');
    expect(scope.structural).toBe(true);
    expect(scope.paragraphIds.size).toBe(0);
    expect([...scope.dependencyKeys]).toEqual(['page-geometry']);
  });
});

describe('scheduling coalesces and stays cancellable (task 9.1)', () => {
  test('many commits in one turn produce ONE layout pass', () => {
    const h = harness();
    for (let index = 0; index < 5; index += 1) {
      h.setRevision(index + 1);
      h.scheduler.notify(change({ dirty: [`p${index}`], toRevision: index + 1 }));
    }
    expect(h.queueLength()).toBe(1);
    h.step();
    expect(h.runs.length).toBe(1);
    expect(h.published.length).toBe(1);
  });

  test('nothing pending means nothing published', () => {
    const h = harness();
    expect(h.scheduler.flush()).toBe(false);
    expect(h.published.length).toBe(0);
    expect(h.scheduler.pending()).toBeNull();
  });

  test('cancel drops pending work without publishing', () => {
    const h = harness();
    h.scheduler.notify(change({ dirty: ['p1'] }));
    h.scheduler.cancel();
    h.step();
    expect(h.runs.length).toBe(0);
    expect(h.published.length).toBe(0);
    expect(h.scheduler.pending()).toBeNull();
  });

  test('flush runs pending work now and disarms the scheduled pass', () => {
    const h = harness();
    h.scheduler.notify(change({ dirty: ['p1'] }));
    expect(h.scheduler.flush()).toBe(true);
    h.step();
    // The queued callback must not run the same work a second time.
    expect(h.runs.length).toBe(1);
  });
});

describe('a layout computed against a superseded revision is never published (task 9.1)', () => {
  test('a commit landing DURING layout discards the result and re-arms', () => {
    // The whole point: the run reads revision 1, the user types, and the finished layout
    // describes a document that no longer exists.
    let firstRun = true;
    const h = harness({
      revisionDuringRun: () => {
        if (!firstRun) return 2;
        firstRun = false;
        return 2;
      },
    });
    h.scheduler.notify(change({ dirty: ['p1'], toRevision: 1 }));
    expect(h.scheduler.flush()).toBe(false);
    expect(h.published.length).toBe(0);
    expect(h.scheduler.staleDiscards).toBe(1);
    // Re-armed rather than dropped, so the newer revision still gets laid out.
    expect(h.scheduler.pending()).not.toBeNull();
    expect(h.scheduler.pending()!.revision).toBe(2);
  });

  test('the discarded scope is carried into the retry, not lost', () => {
    let runs = 0;
    const h = harness({
      revisionDuringRun: () => {
        runs += 1;
        return runs === 1 ? 2 : 2;
      },
    });
    h.scheduler.notify(
      change({ dirty: ['p1'], impact: 'flow-structural', dependencyKeys: ['style:A'] })
    );
    h.scheduler.flush();
    const retry = h.scheduler.pending()!;
    expect(retry.impact).toBe('flow-structural');
    expect(retry.structural).toBe(true);
    expect([...retry.paragraphIds]).toEqual(['p1']);
    expect([...retry.dependencyKeys]).toEqual(['style:A']);
  });

  test('the retry publishes once the model stops moving', () => {
    let runs = 0;
    const h = harness({ revisionDuringRun: () => (runs++ === 0 ? 2 : 2) });
    h.scheduler.notify(change({ dirty: ['p1'], toRevision: 1 }));
    h.scheduler.flush();
    expect(h.published.length).toBe(0);
    // Second pass reads revision 2 and the model is still at 2.
    expect(h.scheduler.flush()).toBe(true);
    expect(h.published.length).toBe(1);
    expect(h.published[0]!.layout.revision).toBe(2);
    expect(h.scheduler.staleDiscards).toBe(1);
  });

  test('an abandoned pass re-arms itself, so nothing waits for an unrelated flush', () => {
    let runs = 0;
    const h = harness({ revisionDuringRun: () => (runs++ === 0 ? 2 : 2) });
    h.scheduler.notify(change({ dirty: ['p1'], toRevision: 1 }));
    h.step();
    // Discarded as stale. The carried-forward scope has to schedule its own retry: a host
    // that supplies no `schedule` strands it until something else happens to flush, and a
    // surface sitting on a stale paint cannot write a post-edit caret into it.
    expect(h.published.length).toBe(0);
    expect(h.scheduler.staleDiscards).toBe(1);
    expect(h.queueLength()).toBe(1);

    h.step();
    expect(h.published.length).toBe(1);
    expect(h.published[0]!.layout.revision).toBe(2);
  });

  test('a current layout publishes with the scope it was computed for', () => {
    const h = harness();
    h.scheduler.notify(change({ dirty: ['p1'], toRevision: 1 }));
    expect(h.scheduler.flush()).toBe(true);
    expect(h.published[0]!.layout.revision).toBe(1);
    expect([...h.published[0]!.scope.paragraphIds]).toEqual(['p1']);
    expect(h.scheduler.staleDiscards).toBe(0);
  });
});

describe('a global relayout runs cooperatively and cancels cleanly (task 9.5)', () => {
  /** A run that finishes after a fixed number of slices, so cancellation has a window. */
  function slicedHarness(slices: number) {
    let revision = 1;
    const published: SemanticLayout[] = [];
    const started: number[] = [];
    const cancelled: number[] = [];
    let nextId = 0;
    const scheduler = createLayoutScheduler({
      run: (scope) => layoutAt(scope.revision),
      currentRevision: () => revision,
      publish: (layout) => published.push(layout),
      runCooperatively: (scope) => {
        const id = nextId++;
        started.push(id);
        let remaining = slices;
        return {
          step: () => {
            remaining -= 1;
            return remaining <= 0 ? layoutAt(scope.revision) : null;
          },
          cancel: () => cancelled.push(id),
        };
      },
    });
    return { scheduler, published, started, cancelled, setRevision: (n: number) => (revision = n) };
  }

  test('a sliced run completes and publishes exactly one layout', () => {
    const h = slicedHarness(4);
    h.scheduler.notify(change({ dirty: ['p1'], toRevision: 1 }));
    expect(h.scheduler.flush()).toBe(true);
    expect(h.published).toHaveLength(1);
    expect(h.started).toHaveLength(1);
    expect(h.cancelled).toHaveLength(0);
  });

  test('nothing partial is ever published', () => {
    // The whole point of slicing is that a half-laid-out document is never shown; a run
    // either produces a complete layout or produces nothing.
    const h = slicedHarness(3);
    h.scheduler.notify(change({ dirty: ['p1'] }));
    h.scheduler.flush();
    expect(h.published.every((layout) => layout.revision === 1)).toBe(true);
  });

  test('teardown abandons a run rather than leaving it to finish', () => {
    const h = slicedHarness(3);
    h.scheduler.notify(change({ dirty: ['p1'] }));
    h.scheduler.cancel();
    expect(h.published).toHaveLength(0);
    expect(h.scheduler.pending()).toBeNull();
  });

  test('a cooperative run still refuses to publish against a superseded revision', () => {
    // Slicing must not weaken the staleness rule: the check happens after the work either
    // way.
    let revision = 1;
    const published: SemanticLayout[] = [];
    const scheduler = createLayoutScheduler({
      run: (scope) => layoutAt(scope.revision),
      currentRevision: () => revision,
      publish: (layout) => published.push(layout),
      runCooperatively: (scope) => ({
        step: () => {
          // A commit lands while the slices are running.
          revision = 7;
          return layoutAt(scope.revision);
        },
        cancel: () => {},
      }),
    });
    scheduler.notify(change({ dirty: ['p1'], toRevision: 1 }));
    expect(scheduler.flush()).toBe(false);
    expect(published).toHaveLength(0);
    expect(scheduler.staleDiscards).toBe(1);
  });

  test('without a slicer the plain run is used, so slicing stays optional', () => {
    const h = harness();
    h.scheduler.notify(change({ dirty: ['p1'] }));
    expect(h.scheduler.flush()).toBe(true);
    expect(h.runs).toHaveLength(1);
  });
});
