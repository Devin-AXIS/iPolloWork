// Where two passes' per-block flow keys agree: the incremental layout resumes after the shared
// prefix and may reconverge inside the shared suffix (`section-flow-keys.ts`).

/** How many leading keys `current` shares with `previous`. */
export function commonKeyPrefix(current: readonly string[], previous: readonly string[]): number {
  const limit = Math.min(current.length, previous.length);
  let index = 0;
  while (index < limit && current[index] === previous[index]) index += 1;
  return index;
}

/** How many trailing keys `current` shares with `previous`, without reaching the first `skip`. */
export function commonKeySuffix(
  current: readonly string[],
  previous: readonly string[],
  skip: number
): number {
  const limit = Math.min(current.length, previous.length) - skip;
  let count = 0;
  while (
    count < limit &&
    current[current.length - 1 - count] === previous[previous.length - 1 - count]
  )
    count += 1;
  return count;
}
