// Test seam: observe the exclusion-relay layout passes `semantic-layout.ts` runs.

let observerForTest: (() => void) | null = null;

/** Observe exclusion-relay layout passes in deterministic tests. @internal */
export function observeExclusionLayoutPassesForTest(observer: () => void): () => void {
  observerForTest = observer;
  return () => {
    if (observerForTest === observer) observerForTest = null;
  };
}

/** Report one exclusion-relay layout pass to the observer, when a test set one. */
export function noteExclusionLayoutPass(): void {
  observerForTest?.();
}
