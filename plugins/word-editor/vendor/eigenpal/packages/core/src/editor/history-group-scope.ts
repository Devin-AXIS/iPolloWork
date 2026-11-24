// The history group of the command being executed, for the surface's write path.
//
// `Editor.exec` takes `historyGroup` as an option, and the surface verb it dispatches to
// (`setRunProperty`, `setParagraphProperty`, ...) commits through `applyOps` several calls
// down without an options parameter of its own. Threading one through every formatting
// verb would touch each of them for a value none of them interprets, so the facade binds
// the group for the synchronous span of the command instead, and the surface's commit
// path reads it.
//
// Bound to ONE owner — the surface whose command it is — and TAKEN by that owner's first
// commit, which clears it. Two things follow. Another editor instance written to from
// inside the span (a change listener that mirrors an edit elsewhere) reads nothing, so a
// gesture token never crosses editors. And host code that runs after the command's own
// write, inside the same span (`onChange`, `onTrackedChange`, a store subscriber), finds
// the group already taken, so its writes are their own undo steps. Bound exactly, not
// inherited: a nested `exec` without a group runs ungrouped, and the type-buffer flush
// binds its typing run's own group, because buffered keystrokes that land at the head of a
// grouped command are an edit of their own, not a frame of the gesture.

import type { HistoryGroup } from '@docx-editor.dev/core/store';

let active: { readonly owner: object; readonly group: HistoryGroup } | null = null;

/** Run `run` with `group` (or none) bound to `owner` for every commit inside it. */
export function runWithHistoryGroup<T>(
  owner: object,
  group: HistoryGroup | undefined,
  run: () => T
): T {
  const previous = active;
  active = group === undefined ? null : { owner, group };
  try {
    return run();
  } finally {
    active = previous;
  }
}

/** Take the history group bound to `owner` by the command in flight, or `undefined`. */
export function takeHistoryGroup(owner: object): HistoryGroup | undefined {
  if (active === null || active.owner !== owner) return undefined;
  const { group } = active;
  active = null;
  return group;
}

/** Hand a taken group back: the commit that took it landed nothing, so the command's real write is still to come. */
function returnHistoryGroup(owner: object, group: HistoryGroup): void {
  if (active === null) active = { owner, group };
}

/**
 * The group of the commit a surface is running, for its write path to stamp on the
 * transaction.
 *
 * `around` takes the bound group for `owner` and holds it for the span of `run` — the
 * surface's `commitNow` body — then restores whatever was held before. Restored, not
 * cleared: a listener that writes back through a surface verb during the commit re-enters
 * `around`, and the outer command's later writes must keep their group. Taken AFTER the
 * type-buffer flush has run inside the same commit, which is safe because the flush binds
 * its typing run's group for its own span, takes only that, and restores the command's
 * group when it returns. A commit that LANDS nothing —
 * a verb reporting a refusal before its real write — hands the group back, so the write
 * that follows in the same command still carries it.
 */
export class CommitHistoryGroup {
  private current: HistoryGroup | undefined;

  /** The group the commit carries, or `undefined` for ungrouped automation. */
  get value(): HistoryGroup | undefined {
    return this.current;
  }

  around<T>(owner: object, run: () => T, landed: (result: T) => boolean, separate = true): T {
    const outer = this.current;
    const group = takeHistoryGroup(owner);
    // Surface commands have explicit boundaries; automation retains its own capture policy.
    this.current = group ?? (separate ? Symbol('command') : undefined);
    let result: T;
    try {
      result = run();
    } finally {
      this.current = outer;
    }
    if (group !== undefined && !landed(result)) returnHistoryGroup(owner, group);
    return result;
  }
}
