// One paste gesture probes and projects the SAME string (in either order); this
// single-entry memo keeps the second call from re-running the full parse + walk on
// a multi-MiB payload. A scheduled clear drops the retained payload as soon as the
// gesture's synchronous handlers finish, so attacker-sized bytes never idle here.

export function createGestureMemo<T>(): (html: string, key: string, compute: () => T) => T {
  let memo: { readonly html: string; readonly key: string; readonly value: T } | null = null;
  return (html, key, compute) => {
    if (memo !== null && memo.html === html && memo.key === key) {
      // A gesture reads the memo exactly once (probe + project). Releasing on the
      // hit drops the payload synchronously — a throttled tab's clamped timer must
      // not keep attacker-sized bytes resident.
      const value = memo.value;
      memo = null;
      return value;
    }
    const value = compute();
    const entry = { html, key, value };
    memo = entry;
    // Any window's task will do: this only releases memory.
    globalThis.setTimeout(() => {
      if (memo === entry) memo = null;
    }, 0);
    return value;
  };
}
