import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';

/**
 * Observe the store's split result without enumerating every paragraph in the story.
 *
 * `currentTail` re-reads the tail after the commit: a collaboration session can give the new
 * paragraph another id within the same commit, and that rename publishes no split record.
 */
export function withSplitSelection(
  session: Pick<TreeDocxSessionView, 'subscribe'>,
  paragraphId: string,
  run: (selectionAfter: () => SemanticSelection | null) => void,
  currentTail: (tail: string, head: string) => string | null = (tail) => tail
): void {
  let tail: string | undefined;
  const unsubscribe = session.subscribe((change) => {
    for (const effect of change.splitJoin)
      if ('split' in effect && effect.split.from === paragraphId) tail = effect.split.tail;
  });
  try {
    run(() => {
      const current = tail && currentTail(tail, paragraphId);
      if (!current) return null;
      const position = { paragraphId: current, offset: 0 };
      return { anchor: position, head: position };
    });
  } finally {
    unsubscribe();
  }
}

interface ActiveCommit {
  depth: number;
  settled?: Promise<void>;
  resolve?: () => void;
}
const commits = new WeakMap<HTMLElement, ActiveCommit>();

/** Reentrant saves wait until the active edit installs its final selection. */
export function pendingSurfaceCommit(container: HTMLElement): Promise<void> | undefined {
  const active = commits.get(container);
  if (!active) return undefined;
  active.settled ??= new Promise((resolve) => {
    active.resolve = resolve;
  });
  return active.settled;
}

/** Balance in finally, including nested edits and exceptions from host callbacks. */
export function beginSurfaceCommit(container: HTMLElement): () => void {
  const active = commits.get(container) ?? { depth: 0 };
  active.depth++;
  commits.set(container, active);
  return () => {
    if (--active.depth !== 0) return;
    commits.delete(container);
    active.resolve?.();
  };
}
