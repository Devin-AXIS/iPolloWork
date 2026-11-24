// One call per frame, however many requests arrive before it.
//
// A wheel fires far more scroll events than there are frames, and each repaint costs the same
// whether one event asked for it or twenty. Falls back to a microtask where the view has no
// animation frames (a detached document, a headless test).

/**
 * `run`, coalesced to the next animation frame of the window `node` lives in.
 *
 * The window is resolved per request, not once: the node can move to another window, and a
 * frame requested from a hidden opener never fires.
 */
export function frameCoalescer(node: Node, run: () => void): () => void {
  /** The window the pending frame was requested from; `undefined` when none is pending. */
  let pending: Window | null | undefined = undefined;
  const fire = (): void => {
    if (pending === undefined) return;
    pending = undefined;
    run();
  };
  return () => {
    const view = node.ownerDocument?.defaultView ?? null;
    // A frame pending in ANOTHER window may never come (that window is hidden or closed), so a
    // request after a move asks the current one; whichever fires first runs once.
    if (pending !== undefined && pending === view) return;
    pending = view;
    if (view && typeof view.requestAnimationFrame === 'function') view.requestAnimationFrame(fire);
    else queueMicrotask(fire);
  };
}
