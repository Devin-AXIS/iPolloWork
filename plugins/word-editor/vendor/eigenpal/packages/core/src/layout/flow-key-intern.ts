// One string per extended flow key across passes. The section prepass extends a block's own
// key with what its neighbours decide (list markers, spacing verdicts, keep chains). Built
// again each pass, every extended key was a new string, so the pass's "unchanged since last
// time" scan compared every such key character by character. Answering the same key, tag and
// value with last pass's string lets that scan stop at the reference.

/** Extended keys by tag, then base key, then value. */
export type FlowKeyIntern = Map<string, Map<string, Map<string, string>>>;

let active: {
  readonly previous: FlowKeyIntern | undefined;
  readonly current: FlowKeyIntern;
} | null = null;

/**
 * Run `build` with {@link extendedFlowKey} answering from `previous` (the last pass's memo),
 * and return its result with this pass's memo, which holds only the keys this pass used.
 */
export function withFlowKeyIntern<T>(
  previous: FlowKeyIntern | undefined,
  build: () => T
): { readonly result: T; readonly intern: FlowKeyIntern } {
  const outer = active;
  const current: FlowKeyIntern = new Map();
  active = { previous, current };
  try {
    return { result: build(), intern: current };
  } finally {
    active = outer;
  }
}

/**
 * `key + tag + value`, as the same string as last pass's when all three are unchanged. The
 * value is a lookup key of its own, not concatenated first: a stored token (a list marker's)
 * is the same string each pass, so it is hashed once rather than copied into a new suffix.
 */
export function extendedFlowKey(key: string, tag: string, value: string): string {
  const state = active;
  if (!state) return key + tag + value;
  let byKey = state.current.get(tag);
  if (!byKey) state.current.set(tag, (byKey = new Map()));
  let byValue = byKey.get(key);
  const hit = byValue?.get(value);
  if (hit !== undefined) return hit;
  const extended = state.previous?.get(tag)?.get(key)?.get(value) ?? key + tag + value;
  if (!byValue) byKey.set(key, (byValue = new Map()));
  byValue.set(value, extended);
  return extended;
}
