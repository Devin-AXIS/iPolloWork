// A block whose new record says exactly what its painted element already shows.

import type { BlockFragmentRecord } from '../layout/semantic-records.ts';

/** Values compared before a block is repainted instead; a long table is cheaper to paint. */
const COMPARISON_BUDGET = 20_000;

function plainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Structural equality over layout records: arrays and plain objects by content, everything
 * else by identity. A Map, a Set or a class instance has state `Object.keys` cannot see, so
 * only the same object counts as equal.
 */
function sameRecord(left: unknown, right: unknown, budget: { left: number }): boolean {
  if (left === right) return true;
  if (--budget.left < 0) return false;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null)
    return false;
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1)
      if (!sameRecord(left[index], right[index], budget)) return false;
    return true;
  }
  if (Array.isArray(right) || !plainObject(left) || !plainObject(right)) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    const a = (left as Record<string, unknown>)[key];
    const b = (right as Record<string, unknown>)[key];
    if (!sameRecord(a, b, budget)) return false;
  }
  return true;
}

/**
 * The element painted for an equal record of the same block, if the previous pass had one.
 *
 * Layout places every block after an edit again until the flow settles, and a block placed
 * again is a new record even where nothing about it moved. Identity alone repainted every
 * such block on the page per keystroke. Paint is a function of the record and the paint
 * parameters, and the caller only asks under unchanged parameters, so an equal record means
 * the element in hand is what painting would build.
 */
export function equalBlockElement(
  previous: ReadonlyMap<BlockFragmentRecord, HTMLElement>,
  fragment: BlockFragmentRecord,
  claimed: readonly HTMLElement[]
): HTMLElement | undefined {
  for (const [record, element] of previous) {
    if (record.id !== fragment.id || claimed.includes(element)) continue;
    return sameRecord(record, fragment, { left: COMPARISON_BUDGET }) ? element : undefined;
  }
  return undefined;
}
