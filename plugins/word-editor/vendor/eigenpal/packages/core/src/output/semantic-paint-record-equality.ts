// Structural equality over layout records, for paint reuse decisions.
//
// Paint keeps an element only when every value it was built from is unchanged. Layout hands
// back new record objects whenever geometry moves, so identity alone refuses most of them;
// this compares their plain data instead. Anything that is not a plain object or array (a
// Map, a class instance, a typed array) must be the SAME object, and a record nested past
// the depth limit is refused rather than walked: a refusal costs a repaint, never a wrong one.

const MAX_DEPTH = 32;

/** Objects one comparison may visit; past it the comparison refuses. Absent: unbounded. */
interface Budget {
  remaining: number;
}

function isPlain(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === Array.prototype || prototype === null;
}

function sameValue(left: unknown, right: unknown, depth: number, budget?: Budget): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  if (depth > MAX_DEPTH || !isPlain(left) || !isPlain(right)) return false;
  if (budget && --budget.remaining < 0) return false;
  const leftArray = Array.isArray(left);
  if (leftArray !== Array.isArray(right)) return false;
  if (leftArray) {
    const a = left as readonly unknown[];
    const b = right as readonly unknown[];
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!sameValue(a[index], b[index], depth + 1, budget)) return false;
    }
    return true;
  }
  return sameFields(left, right, undefined, depth, budget);
}

function sameFields(
  left: object,
  right: object,
  skip: ReadonlySet<string> | undefined,
  depth: number,
  budget?: Budget
): boolean {
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  let count = 0;
  for (const key in a) {
    if (!Object.hasOwn(a, key) || skip?.has(key)) continue;
    if (!Object.hasOwn(b, key) || !sameValue(a[key], b[key], depth + 1, budget)) return false;
    count += 1;
  }
  for (const key in b) {
    if (Object.hasOwn(b, key) && !skip?.has(key)) count -= 1;
  }
  return count === 0;
}

/**
 * True when two records hold equal plain data in every own field outside `skip`.
 *
 * A field present on one side only is a difference, even when its value is `undefined`.
 */
export function sameRecordExcept(left: object, right: object, skip: ReadonlySet<string>): boolean {
  if (left === right) return true;
  if (!isPlain(left) || !isPlain(right)) return false;
  return sameFields(left, right, skip, 0);
}

/**
 * True when two values hold equal plain data, visiting at most `maxObjects` objects.
 *
 * For records whose size paint does not control, such as a header or footer story that layout
 * rebuilt with the same content: a large or deep difference refuses instead of walking on.
 */
export function sameDataWithin(left: unknown, right: unknown, maxObjects: number): boolean {
  return sameValue(left, right, 0, { remaining: maxObjects });
}
