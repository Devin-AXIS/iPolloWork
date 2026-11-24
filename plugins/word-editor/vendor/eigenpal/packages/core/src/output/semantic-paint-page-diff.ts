// Which parts of a painted page moved between two layout passes, for page adoption.
//
// A page whose record changed only in its body blocks, or only in its header or footer, keeps
// its sheet: paint rebuilds the part that moved and leaves everything else in place. The
// test is written against the record's own keys rather than a hand-listed set, so a field
// added to `PageRecord` later disables adoption (a slower repaint) instead of silently
// painting the page without it.

import type { PageRecord } from '../layout/semantic-records.ts';
import { sameDataWithin } from './semantic-paint-record-equality.ts';

/** Objects one page-field comparison may visit before adoption gives up on it. */
const PAGE_RECORD_COMPARE_BUDGET = 20_000;

/** Every own key equal by identity, with no nested object on either side. */
function samePlainValues(left: object, right: object): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    // A nested object that is the SAME object is fine; a different one is not comparable
    // here, and the identity test refuses it.
    if ((left as Record<string, unknown>)[key] !== (right as Record<string, unknown>)[key])
      return false;
  }
  return true;
}

function sameItems(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * Whether one page field paints the same. Layout hands untouched sub-records back by
 * identity; a record rebuilt with the same data (a footer re-projected for an unchanged page
 * number) paints the same too, within a bound, so a large or changed story refuses.
 */
function samePageValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b) && sameItems(a, b)) return true;
  if (
    typeof a === 'object' &&
    typeof b === 'object' &&
    a !== null &&
    b !== null &&
    !Array.isArray(a) &&
    !Array.isArray(b) &&
    samePlainValues(a, b)
  ) {
    return true;
  }
  return sameDataWithin(a, b, PAGE_RECORD_COMPARE_BUDGET);
}

/** The parts of a page that changed, when nothing else on it did. */
export interface ChangedPageParts {
  /** The body blocks. */
  readonly blocks: boolean;
  /** The header or footer story, present on both records. */
  readonly furniture: boolean;
}

/**
 * The page parts that changed between two records of one page, or null when anything else
 * changed. A header or footer that appears or goes away is "anything else": the blank-story
 * band painted in its place belongs to the sheet.
 */
export function changedPageParts(previous: PageRecord, next: PageRecord): ChangedPageParts | null {
  if (previous === next) return null;
  let blocks = false;
  let furniture = false;
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    // Paint never reads the page-field source: the header, footer and body field records that
    // show a page number carry its effect, and they are compared like everything else.
    if (key === 'pageFieldSource') continue;
    const a = (previous as unknown as Record<string, unknown>)[key];
    const b = (next as unknown as Record<string, unknown>)[key];
    if (key === 'fragments') {
      blocks ||= a !== b;
      continue;
    }
    if (samePageValue(a, b)) continue;
    if ((key === 'header' || key === 'footer') && a && b) {
      furniture = true;
      continue;
    }
    return null;
  }
  return { blocks, furniture };
}
