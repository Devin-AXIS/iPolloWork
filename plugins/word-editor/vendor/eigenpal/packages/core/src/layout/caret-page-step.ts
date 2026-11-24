// The sheet a PageUp / PageDown press lands on.

/**
 * The nearest sheet past `from` in `direction` that holds a caret stop, or `undefined` past the
 * last one. A sheet with no stops (a blank parity sheet, a note-only sheet) is stepped over, so
 * the press moves one sheet of text instead of falling through to the document edge.
 */
export function nearestPageWithStops(
  stops: readonly { readonly pageIndex: number }[],
  from: number,
  direction: -1 | 1
): number | undefined {
  let found: number | undefined;
  for (const { pageIndex } of stops) {
    if ((pageIndex - from) * direction <= 0) continue;
    if (found === undefined || (pageIndex - found) * direction < 0) found = pageIndex;
  }
  return found;
}
