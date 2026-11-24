// Header/footer hover affordance: the suppression contract.
//
// The blank band's "double-click to add header" invitation, and the tint on an existing
// band, are pure CSS. Viewing mode (and an open furniture scope) cancels them with a second
// rule rather than a different class on the band — so the cancel only lands if it WINS.
//
// It did not. The footer variant carried `[data-docx-hf='footer']` and the existing-band
// tint carried two `:not()`s, which outweighed a plainer suppressor; a reader in Viewing
// kept being invited to add a footer. Specificity is invisible at a glance and nothing else
// in the suite resolves a cascade, so the contract is asserted here directly.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';

const cssPath = resolve(import.meta.dir, '../editor.css');
const css = readFileSync(cssPath, 'utf8');

/** The two mode classes that must cancel a write affordance. */
const SUPPRESSORS = ['.docx-pages--hf-editing', '.docx-paginated-surface--viewing'] as const;

/**
 * `(a, b, c)` per the selectors spec, packed for comparison. Enough for this stylesheet:
 * no `!important`, no `:is()`/`:not()` nesting beyond one level.
 */
function specificity(selector: string): number {
  // `:not(...)` takes the weight of its most specific argument — unwrap and count inside.
  const flattened = selector.replace(/:not\(([^)]*)\)/g, ' $1 ');
  const elements = flattened.match(/::[\w-]+/g)?.length ?? 0;
  // Pseudo-ELEMENTS out of the way first, or `::after` also reads as the class-weight
  // pseudo-class `:after` and every hint rule comes out one class too heavy.
  const classLevel = flattened.replace(/::[\w-]+/g, ' ');
  const ids = classLevel.match(/#[\w-]+/g)?.length ?? 0;
  const classes =
    (classLevel.match(/\.[\w-]+/g)?.length ?? 0) +
    (classLevel.match(/\[[^\]]+\]/g)?.length ?? 0) +
    (classLevel.match(/:[\w-]+/g)?.length ?? 0);
  return ids * 10_000 + classes * 100 + elements;
}

interface Occurrence {
  readonly selector: string;
  readonly index: number;
  readonly specificity: number;
}

/** Every selector in the sheet that declares `property`, in source order. */
function declarationsOf(property: string): Occurrence[] {
  const found: Occurrence[] = [];
  let index = 0;
  postcss.parse(css, { from: cssPath }).walkRules((rule) => {
    let declares = false;
    rule.walkDecls((decl) => {
      if (decl.prop === property) declares = true;
    });
    if (!declares) return;
    for (const selector of rule.selectors) {
      found.push({
        selector: selector.replace(/\s+/g, ' ').trim(),
        index: (index += 1),
        specificity: specificity(selector),
      });
    }
  });
  return found;
}

/**
 * Does a mode-gated rule beat `invitation`? The cascade takes the higher specificity, and
 * source order only on a tie — so a suppressor that ties must also come LATER.
 */
function isSuppressor(selector: string): boolean {
  return SUPPRESSORS.some((mode) => selector.includes(mode));
}

function suppressed(invitation: Occurrence, property: string): boolean {
  return declarationsOf(property).some(
    (candidate) =>
      isSuppressor(candidate.selector) &&
      candidate.specificity >= invitation.specificity &&
      (candidate.specificity > invitation.specificity || candidate.index > invitation.index)
  );
}

describe('header/footer affordance suppression', () => {
  test('every hover invitation is outranked by a mode-gated rule', () => {
    // The invitations: the blank band's hint text, and the tint on any hovered band.
    const isInvitation = (selector: string): boolean =>
      selector.includes('.docx-hf') && selector.includes(':hover') && !isSuppressor(selector);
    const hints = declarationsOf('content').filter((rule) => isInvitation(rule.selector));
    expect(hints.length).toBeGreaterThanOrEqual(2);
    const tints = declarationsOf('background').filter((rule) => isInvitation(rule.selector));
    expect(tints.length).toBeGreaterThanOrEqual(2);

    for (const hint of hints)
      expect([hint.selector, suppressed(hint, 'content')]).toEqual([hint.selector, true]);
    for (const tint of tints)
      expect([tint.selector, suppressed(tint, 'background')]).toEqual([tint.selector, true]);
  });

  test('the specificity helper agrees with the spec on the shapes this sheet uses', () => {
    expect(specificity('.docx-pages .docx-hf--placeholder:hover')).toBe(300);
    // `[data-docx-hf='footer']` is the qualifier that used to win.
    expect(specificity(".docx-pages .docx-hf--placeholder[data-docx-hf='footer']:hover")).toBe(400);
    // Both `:not()` arguments count.
    expect(
      specificity(
        '.docx-pages .docx-hf:not([data-docx-hf-active]):not(.docx-hf--placeholder):hover'
      )
    ).toBe(500);
    expect(specificity('.docx-pages .docx-hf--placeholder:hover::after')).toBe(301);
  });
});
